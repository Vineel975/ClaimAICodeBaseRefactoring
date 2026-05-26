"use client";

import {
  isServer,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import * as React from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { TooltipProvider } from "@/components/ui/tooltip";

function getPublicConvexUrl(): string {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured.");
  }
  return url;
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 0,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined = undefined;

function getQueryClient() {
  if (isServer) {
    // Server: always make a new query client
    return makeQueryClient();
  } else {
    // Browser: make a new query client if we don't already have one
    // This is very important, so we don't re-make a new client if React
    // suspends during the initial render. This may not be needed if we
    // have a suspense boundary BELOW the creation of the query client
    if (!browserQueryClient) browserQueryClient = makeQueryClient();
    return browserQueryClient;
  }
}

let browserConvexClient: ConvexReactClient | undefined = undefined;

function getConvexClient() {
  const convexUrl = getPublicConvexUrl();

  if (isServer) {
    return new ConvexReactClient(convexUrl);
  } else {
    if (!browserConvexClient) {
      browserConvexClient = new ConvexReactClient(convexUrl);
    }
    return browserConvexClient;
  }
}

export default function Providers({ children }: { children: React.ReactNode }) {
  // NOTE: Avoid useState when initializing the query client if you don't
  //       have a suspense boundary between this and the code that may
  //       suspend because React will throw away the client on the initial
  //       render if it suspends and there is no boundary
  const queryClient = getQueryClient();
  const convexClient = getConvexClient();

  return (
    <ConvexProvider client={convexClient}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    </ConvexProvider>
  );
}
