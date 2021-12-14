import { APIGatewayProxyHandler } from "aws-lambda";

export const handler: APIGatewayProxyHandler = async (event) => {
  console.log("hello world");
  console.log(event);

  return {
    statusCode: 200,
    body: JSON.stringify({ message: "hello world" }),
  };
};
