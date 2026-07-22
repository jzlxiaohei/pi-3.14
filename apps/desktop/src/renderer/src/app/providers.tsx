import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import type { JSX } from "solid-js";
import { OrbitToaster } from "@/shared/ui/toast";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false
    }
  }
});

export function Providers(props: { children: JSX.Element }) {
  return (
    <QueryClientProvider client={queryClient}>
      {props.children}
      <OrbitToaster />
    </QueryClientProvider>
  );
}
