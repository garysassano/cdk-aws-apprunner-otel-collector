import {
  Service,
  Source,
  Secret as ApprunnerSecret,
} from "@aws-cdk/aws-apprunner-alpha";
import {
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import {
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import {
  Architecture,
  LayerVersion,
  LoggingFormat,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Bucket } from "aws-cdk-lib/aws-s3";
import {
  BucketDeployment,
  Source as S3Source,
} from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";
import { join } from "path";
import { validateEnv } from "../utils/validate-env";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";

const env = validateEnv(["HONEYCOMB_API_KEY"]);

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    //==============================================================================
    // SECRETS MANAGER
    //==============================================================================

    const honeycombApiKeySecret = new Secret(this, "HoneycombApiKeySecret", {
      secretName: "honeycomb-api-key",
      secretStringValue: SecretValue.unsafePlainText(env.HONEYCOMB_API_KEY),
      removalPolicy: RemovalPolicy.DESTROY,
    });

    //==============================================================================
    // S3
    //==============================================================================

    const confmapBucket = new Bucket(this, "ConfmapBucket", {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    new BucketDeployment(this, "DeployConfmap", {
      sources: [S3Source.asset(join(__dirname, "..", "otel"))],
      destinationBucket: confmapBucket,
    });

    //==============================================================================
    // IAM
    //==============================================================================

    // Role to get confmap file from S3 bucket
    const apprunnerInstanceRole = new Role(this, "ApprunnerInstanceRole", {
      assumedBy: new ServicePrincipal("tasks.apprunner.amazonaws.com"),
      inlinePolicies: {
        S3Access: new PolicyDocument({
          statements: [
            new PolicyStatement({
              actions: ["s3:GetObject"],
              resources: [confmapBucket.arnForObjects("*")],
            }),
          ],
        }),
      },
    });

    //==============================================================================
    // APP RUNNER
    //==============================================================================

    const adotCollectorService = new Service(this, "AdotCollectorService", {
      instanceRole: apprunnerInstanceRole,
      source: Source.fromEcrPublic({
        imageIdentifier:
          "public.ecr.aws/aws-observability/aws-otel-collector:latest",
        imageConfiguration: {
          port: 4318,
          startCommand: `--config s3://${confmapBucket.bucketName}.s3.${this.region}.amazonaws.com/collector-confmap.yml`,
          environmentSecrets: {
            HONEYCOMB_API_KEY: ApprunnerSecret.fromSecretsManager(
              honeycombApiKeySecret,
            ),
          },
        },
      }),
    });

    //==============================================================================
    // LAMBDA
    //==============================================================================

    const adotNodeLayer = LayerVersion.fromLayerVersionArn(
      this,
      "AdotNodeLayer",
      "arn:aws:lambda:eu-central-1:901920570463:layer:aws-otel-nodejs-arm64-ver-1-30-1:1",
    );

    new NodejsFunction(this, "AdotHelloLambda", {
      functionName: "adot-hello-lambda",
      entry: join(__dirname, "..", "functions/hello", "index.ts"),
      layers: [adotNodeLayer],
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 1024,
      timeout: Duration.minutes(1),
      loggingFormat: LoggingFormat.JSON,
      environment: {
        AWS_LAMBDA_EXEC_WRAPPER: "/opt/otel-handler",
        // OTel SDK
        OTEL_SERVICE_NAME: "adot-hello-lambda",
        OTEL_PROPAGATORS: "tracecontext",
        // OTel Collector
        OTEL_EXPORTER_OTLP_ENDPOINT: `https://${adotCollectorService.serviceUrl}`,
        OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
        OTEL_EXPORTER_OTLP_COMPRESSION: "gzip",
      },
    });
  }
}
