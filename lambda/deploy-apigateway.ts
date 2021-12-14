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
