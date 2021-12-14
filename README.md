# AWS-CDKのCustomResourceでAPIGatewayのStageを更新する

AWS-CDKのカスタムリソースを利用してAPIGatewayのStageを更新します。

cdkを使用するとAPIGateway+Lambdaを爆速で構築でき非常に便利ですが、CloudFormationの仕様上APIGatewayのStageを一度デプロイすると以降は更新を行ってくれません。おそらくcdkでAPIGateway+Lambdaを始めたばかりのほとんどの人が躓くポイントなのかなと思います。

そこで今回はカスタムリソースを使用してAPIGatewayの更新を行うスタックを作成してみました。

(AWS-CDK v2のGAおめでとう🎉)

`node`:v16.13.0

`aws-cdk`:2.1.0

今回のソースコードは[こちら](https://github.com/moricom/cdk-custom-resource)から確認できます。

## 環境構築

はじめにcdk用のフォルダを作って初期化します。

```
mkdir cdk-custom-resource
cd cdk-custom-resource
npx cdk init app --language typescript
```

各種パッケージ群をインストールします

```
yarn add esbuild@0 uuid
yarn add -D @types/uuid aws-lambda @types/aws-lambda
```

Lambdaを格納するディレクトリを作成します。

```
mkdir lambda
```

最終的には下記のような構造にします。

```
$ tree -I node_modules
.
├── README.md
├── bin
│   └── cdk-custom-resource.ts
├── cdk.json
├── jest.config.js
├── lambda
│   ├── deploy-apigateway.ts
│   └── sample.ts
├── lib
│   └── cdk-custom-resource-stack.ts
├── package.json
├── test
│   └── cdk-custom-resource.test.ts
├── tsconfig.json
└── yarn.lock
```

## Stack

本体となるStackです。

`new cr.Provider`でLambdaを使用したカスタムリソースの作成をよしなにしてくれます。`onEventHandler`にカスタムリソース用のLambdaを指定してあげます。ほかにも`isCompleteHandler`や`totalTimeout`などの使えそうなオプションも用意されています。

少しハッキーな点として、カスタムリソースのプロパティに`uuid()`を渡しています。こうすることによってAPIのスタックがDeployされる度にStageの更新を行います。一緒にAPIGatewayのidとステージ名も渡します。

```typescript:lib/cdk-custom-resource-stack.ts
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
```

## Deploy用のLambda

APIGatewayのStageに新しいDeploymentを発行するLambdaです。cdkよりパラメーターとしてRestAPIのIDとStage名を受け取ります。

カスタムリソースのLambdaは`CdkCustomResourceResponse`を返す必要があります。

```typescript:lambda/deploy-apigateway.ts
import { APIGateway } from "aws-sdk";
import {
  CdkCustomResourceEvent,
  CdkCustomResourceHandler,
  CdkCustomResourceResponse,
} from "aws-lambda";

const api = new APIGateway();

const deployApi = async (restApiId: string, stageName: string) => {
  console.log(`deploying ${restApiId}/${stageName}`);

  const deployment = await api
    .createDeployment({
      restApiId,
    })
    .promise();

  const updateResult = await api
    .updateStage({
      restApiId,
      stageName,
      patchOperations: [
        {
          op: "replace",
          path: "/deploymentId",
          value: deployment.id,
        },
      ],
    })
    .promise();
  console.log("complete deploy");

  return updateResult;
};

const putApi = async (
  event: CdkCustomResourceEvent
): Promise<CdkCustomResourceResponse> => {
  const apiId: string = event.ResourceProperties["API_ID"];
  const apiStage: string = event.ResourceProperties["API_STAGE"];

  if (typeof apiId !== "string" || typeof apiStage !== "string") {
    throw new Error('"API_ID" and "API_STAGE" is required');
  }

  const deployResult = await deployApi(apiId, apiStage);

  return {
    PhysicalResourceId: deployResult.deploymentId,
    Data: {
      API_ID: apiId,
      API_STAGE: apiStage,
    },
  };
};

export const handler: CdkCustomResourceHandler = async (event, context) => {
  console.log(event);
  console.log(context);

  switch (event.RequestType) {
    case "Create":
    case "Update":
      return putApi(event);

    case "Delete":
      const promise: CdkCustomResourceResponse = new Promise((resolve) => {
        resolve("ok");
      });
      return promise;
  }
};

export default handler;

```

## API用のサンプルLambda

APIGatewayから呼ばれるサンプル用のLambdaです。

```typescript:lambda/sample.ts
import { APIGatewayProxyHandler } from "aws-lambda";

export const handler: APIGatewayProxyHandler = async (event) => {
  console.log("hello world");
  console.log(event);

  return {
    statusCode: 200,
    body: JSON.stringify({ message: "hello world" }),
  };
};
```

## cdk deploy

最後にデプロイをして完了です。

```
yarn cdk deploy
```

## さいごに

今まではAPIGatewayのステージを更新するLambdをスタックに入れ、`package.json`内に`"deploy:api": "cdk deploy *APIStack && aws lambda invoke --function-name api-deploy-api ..."`のように書いてましたが、カスタムリソースを使うことで関数名をハードに指定する必要が無くなりCI/CDへ組み込めそうです。

お役に立てれば幸いです。

## 参考

https://docs.aws.amazon.com/cdk/api/latest/docs/custom-resources-readme.html

https://github.com/serverless/serverless/issues/4483

