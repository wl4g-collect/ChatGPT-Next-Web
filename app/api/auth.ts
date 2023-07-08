import { NextRequest } from "next/server";
import { getServerSideConfig } from "../config/server";
import md5 from "spark-md5";
import { ACCESS_CODE_PREFIX } from "../constant";
import Jwt from "jsonwebtoken";
import RedisFacade from "../../server/redis/redis_facade";

function getIP(req: NextRequest) {
  const headers: any = req.headers; // Why is it an ordinary object?
  const forwardedFor = headers["x-forwarded-for"];
  let ip = req.ip ?? headers["x-real-ip"];

  if (!ip && forwardedFor) {
    ip = forwardedFor.split(",").at(0) ?? "";
  }

  return ip;
}

function parseApiKey(bearToken: string) {
  const token = bearToken.trim().replaceAll("Bearer ", "").trim();
  const isOpenAiKey = !token.startsWith(ACCESS_CODE_PREFIX);
  return {
    accessCode: isOpenAiKey ? "" : token.slice(ACCESS_CODE_PREFIX.length),
    apiKey: isOpenAiKey ? token : "",
  };
}

export async function auth(req: NextRequest) {
  const headers: any = req.headers; // Why is it an ordinary object?
  const authToken = headers.authorization ?? "";

  // check if it is openai api key or user token.
  const { accessCode, apiKey: token } = parseApiKey(authToken);

  try {
    const decodeJwt = Jwt.decode(token);
    console.log("decodeJWT", decodeJwt);
  } catch (e) {
    console.log("error", e);
  }

  const hashedCode = md5.hash(accessCode ?? "").trim();

  const serverConfig = getServerSideConfig();
  console.log("[Auth] allowed hashed codes: ", [...serverConfig.codes]);
  console.log("[Auth] got access code:", accessCode);
  console.log("[Auth] hashed access code:", hashedCode);
  console.log("[User IP] ", getIP(req));
  console.log("[Time] ", new Date().toLocaleString());

  let password = await RedisFacade.getDefault().get("user_admin");
  console.log("password", password);

  if (serverConfig.needCode && !serverConfig.codes.has(hashedCode) && !token) {
    // TODO: redirect to login/auth page
    return {
      error: true,
      msg: !accessCode ? "empty access code" : "wrong access code",
    };
  }

  // if user does not provide an api key, inject system api key
  if (!token) {
    const apiKey = serverConfig.apiKey;
    if (apiKey) {
      console.info("[Auth] use system api key");
      req.headers.set("Authorization", `Bearer ${apiKey}`);
    } else {
      console.warn("[Auth] admin did not provide an api key");
    }
  } else {
    console.log("[Auth] use user api key");
  }

  return {
    error: false,
  };
}
