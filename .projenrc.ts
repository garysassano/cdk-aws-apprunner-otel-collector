import { awscdk, javascript } from "projen";

const project = new awscdk.AwsCdkTypeScriptApp({
  cdkVersion: "2.178.2",
  defaultReleaseBranch: "main",
  depsUpgradeOptions: { workflow: false },
  devDeps: ["zod"],
  eslint: true,
  minNodeVersion: "22.13.0",
  name: "cdk-aws-apprunner-otel-collector",
  packageManager: javascript.NodePackageManager.PNPM,
  pnpmVersion: "9",
  prettier: true,
  projenrcTs: true,

  deps: [
    "@aws-cdk/aws-apprunner-alpha",
    "@opentelemetry/api",
    "@dev7a/lambda-otel-lite",
    "@types/aws-lambda",
  ],
});

project.synth();
