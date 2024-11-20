import { App } from "aws-cdk-lib";
// import { OtelCollectorStack } from "./stacks/otel-collector";
import { AdotCollectorStack } from "./stacks/adot-collector";

// for development, use account/region from cdk cli
const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new App();

// new OtelCollectorStack(app, "cdk-aws-apprunner-otel-collector-dev", {
//   env: devEnv,
// });

new AdotCollectorStack(app, "cdk-aws-apprunner-adot-collector-dev", {
  env: devEnv,
});

app.synth();
