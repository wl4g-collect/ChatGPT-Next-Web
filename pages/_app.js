import { useRouter } from "next/router";
import { ChakraProvider } from "@chakra-ui/react";
import { SessionProvider } from "next-auth/react";
import "../styles/globals.css";

export default function App({ Component, pageProps: { session, ...pageProps } }) {
  const router = useRouter();
  console.log(1111111);

  // 模拟用户认证状态，您可以根据实际情况进行修改
  const isAuthenticated = false;

  // // 检查认证状态
  // const checkAuthentication = () => {
  //   console.log(22222222);
  //   if (!isAuthenticated && router.pathname !== "/login") {
  //     // router.push("/login");
  //   }
  // };

  // // 在每次路由切换前检查认证状态
  // router.beforePopState(() => {
  //   console.log(33333333);
  //   checkAuthentication();
  //   return true;
  // });

  // // 在初始加载时检查认证状态
  // if (typeof window !== "undefined") {
  //   checkAuthentication();
  // }

  // 渲染登录页面，如果未认证
  if (!isAuthenticated /* && router.pathname === "/login" */) {
    return (
      <ChakraProvider>
        <SessionProvider session={session}>
          <div className="min-h-screen bg-gray-100">
            <Component {...pageProps} />
          </div>
        </SessionProvider>
      </ChakraProvider>
    );
  }

  // 放行其他页面的渲染
  return <Component {...pageProps} />;
}