import { createHmac } from "node:crypto";
import { App } from "octokit";

const OK_RESPONSE = { statusCode: 200 };

async function addToProject(installationId, contentId) {
  const app = new App({
    appId: 311508,
    // If the envar is added directly to the Lambda function it will
    // probably look like:
    // -----BEGIN RSA PRIVATE KEY-----\nMIIEo…
    // with the newlines replaced with literal "\n".
    // Those will be replaced with real newlines below.
    // If the envar is added via CloudFormation or AWS SAM, it will
    // maintain actual newlines and the `replace` will be a no-op.
    // When generating a private key for a GitHub app, it will download a
    // .pem file. The contents of that file is the private key.
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
  });

  const octokit = await app.getInstallationOctokit(installationId);

  const projectOwnerName = "PRX";
  const projectNumber = 3;
  const ownerType = "organization";

  const idResp = await octokit.graphql(
    `query getProject($projectOwnerName: String!, $projectNumber: Int!) {
      ${ownerType}(login: $projectOwnerName) {
        projectV2(number: $projectNumber) {
          id
        }
      }
    }`,
    {
      projectOwnerName,
      projectNumber,
    },
  );

  const projectId = idResp[ownerType]?.projectV2.id;

  await octokit.graphql(
    `mutation addItemToProject {
      addProjectV2ItemById(
        input: {projectId: "${projectId}", contentId: "${contentId}"}
      ) {
        clientMutationId
      }
    }`,
  );
}

async function handleIssue(payload) {
  console.log(JSON.stringify(payload));
  if (payload.action === "opened" && payload.issue.state === "open") {
    await addToProject(payload.installation.id, payload.issue.node_id);
  }
}

async function handlePullRequest(payload) {
  console.log(JSON.stringify(payload));
  if (payload.action === "opened" && payload.pull_request.state === "open") {
    await addToProject(payload.installation.id, payload.pull_request.node_id);
  }
}

export const handler = async (event) => {
  console.log(JSON.stringify(event));
  const githubSignature = event.headers["x-hub-signature"].split("=")[1];

  const key = process.env.GITHUB_WEBHOOK_SECRET;
  const data = event.body;
  const check = createHmac("sha1", key).update(data).digest("hex");

  if (githubSignature !== check) {
    throw new Error("Invalid signature!");
  }

  const body = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf-8")
    : event.body;

  switch (event.headers["x-github-event"]) {
    case "ping":
      // Blackhole `ping` events
      break;
    case "issues":
      await handleIssue(JSON.parse(body));
      break;
    case "pull_request":
      await handlePullRequest(JSON.parse(body));
      break;
    default:
      break;
  }

  return OK_RESPONSE;
};
