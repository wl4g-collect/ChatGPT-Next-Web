import { type OpenAIListModelResponse } from "@/app/client/platforms/openai";
import { getServerSideConfig } from "../../../config/server";
import { OpenaiPath } from "../../../constant";
import { prettyObject } from "../../../utils/format";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "../../auth";
import { requestOpenai } from "../../common";

const ALLOWD_PATH = new Set(Object.values(OpenaiPath));
ALLOWD_PATH.add("/");

function getModels(remoteModelRes: OpenAIListModelResponse) {
  const config = getServerSideConfig();

  if (config.disableGPT4) {
    remoteModelRes.data = remoteModelRes.data.filter(
      (m) => !m.id.startsWith("gpt-4"),
    );
  }

  return remoteModelRes;
}

export default async function handle(req: NextRequest) {
  console.log("[OpenAI Route] req url ", req.url);

  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }

  const subpath = req.url;
  if (!ALLOWD_PATH.has(subpath)) {
    console.log("[OpenAI Route] forbidden path ", subpath);
    return NextResponse.json(
      {
        error: true,
        msg: "you are not allowed to request " + subpath,
      },
      {
        status: 403,
      },
    );
  }

  const authResult = await auth(req);
  if (authResult.error) {
    return NextResponse.json(authResult, {
      status: 401,
    });
  }

  try {
    const response = await requestOpenai(req);

    // list models
    if (subpath === OpenaiPath.ListModelPath && response.status === 200) {
      const resJson = (await response.json()) as OpenAIListModelResponse;
      const availableModels = getModels(resJson);
      return NextResponse.json(availableModels, {
        status: response.status,
      });
    }

    return response;
  } catch (e) {
    console.error("[OpenAI] ", e);
    return NextResponse.json(prettyObject(e));
  }
}

export const GET = handle;
export const POST = handle;

// bugfix: 由于 edge 运行时无法使用 ioredis 等模块, 必须声明运行时为 nodejs
// see:https://github.com/Yidadaa/ChatGPT-Next-Web/issues/2232
export const runtime = "nodejs"; // edge|nodejs|deno|wasm
