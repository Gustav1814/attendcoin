import "@fontsource-variable/geist/index.css";
import "@fontsource-variable/geist-mono/index.css";
import "@fontsource-variable/newsreader/opsz.css";
import "./styles/tokens.css";
import "./styles/global.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { WalletProvider } from "./lib/wallet";
import { ToastProvider } from "./ui/Toast";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
      // Chain state changes under us; refetch when the student comes back to the tab.
      refetchOnWindowFocus: true,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToastProvider>
          <WalletProvider>
            <App />
          </WalletProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
