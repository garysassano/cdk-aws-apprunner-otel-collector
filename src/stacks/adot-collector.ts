import { Service, Source } from "@aws-cdk/aws-apprunner-alpha";
import { Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
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

const { HONEYCOMB_API_KEY } = validateEnv(["HONEYCOMB_API_KEY"]);

export class AdotCollectorStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    const confmapBucket = new Bucket(this, "ConfmapBucket", {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    new BucketDeployment(this, "DeployConfmap", {
      sources: [S3Source.asset(join(__dirname, "..", "otel"))],
      destinationBucket: confmapBucket,
    });

    const apprunnerInstanceRole = new Role(this, "ApprunnerInstanceRole", {
      assumedBy: new ServicePrincipal("tasks.apprunner.amazonaws.com"),
    });

    confmapBucket.addToResourcePolicy(
      new PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [confmapBucket.arnForObjects("*")],
        principals: [apprunnerInstanceRole],
      }),
    );

    const adotCollectorService = new Service(this, "AdotCollectorService", {
      instanceRole: apprunnerInstanceRole,
      source: Source.fromEcrPublic({
        imageIdentifier:
          "public.ecr.aws/aws-observability/aws-otel-collector:latest",
        imageConfiguration: {
          port: 4318,
          startCommand: `--config s3://${confmapBucket.bucketName}.s3.${this.region}.amazonaws.com/collector-confmap.yml`,
          environmentVariables: {
            HONEYCOMB_API_KEY,
          },
        },
      }),
    });

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
