import {
  Stack,
  StackProps,
  aws_iam as iam,
  aws_apigateway as apigateway,
  custom_resources as cr,
  CustomResource,
} from "aws-cdk-lib";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import { v4 as uuid } from "uuid";

const prefix = "cdk-custom-resource";

export class CdkCustomResourceStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const api = new apigateway.RestApi(this, "RestAPI", {
      restApiName: `${prefix}-api`,
    });

    const sampleLambda = new NodejsFunction(this, "SampleFunction", {
      entry: "lambda/sample.ts",
      functionName: `${prefix}-sample`,
    });

    api.root.addMethod("GET", new apigateway.LambdaIntegration(sampleLambda));

    const deployLambda = new NodejsFunction(this, "DeployFunction", {
      entry: "lambda/deploy-apigateway.ts",
      functionName: `${prefix}-api-deploy`,
    });

    const provider = new cr.Provider(this, "Provider", {
      onEventHandler: deployLambda,
    });

    provider.onEventHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["apigateway:POST", "apigateway:PATCH"],
        effect: iam.Effect.ALLOW,
        resources: [
          `arn:aws:apigateway:${this.region}::/restapis/${api.restApiId}/*`,
        ],
      })
    );

    new CustomResource(this, "CustomResource", {
      serviceToken: provider.serviceToken,
      properties: {
        uuid: uuid(),
        API_ID: api.restApiId,
        API_STAGE: api.deploymentStage.stageName,
      },
    });
  }
}
