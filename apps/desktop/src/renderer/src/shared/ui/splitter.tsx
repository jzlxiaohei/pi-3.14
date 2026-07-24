import { Splitter as ArkSplitter, useSplitterContext } from "@ark-ui/solid/splitter";
import type {
  SplitterResizeTriggerProps,
  SplitterRootProps as ArkSplitterRootProps,
  UseSplitterContext,
} from "@ark-ui/solid/splitter";
import type { JSX } from "solid-js";

type SplitterRootProps = {
  children: JSX.Element;
  class?: string;
  classList?: Record<string, boolean | undefined>;
  defaultSize?: ArkSplitterRootProps["defaultSize"];
  onCollapse?: ArkSplitterRootProps["onCollapse"];
  onExpand?: ArkSplitterRootProps["onExpand"];
  orientation?: "horizontal" | "vertical";
  panels: ArkSplitterRootProps["panels"];
};

type SplitterPanelProps = {
  children: JSX.Element;
  class?: string;
  id: string;
};

type SplitterHandleProps = {
  disabled?: boolean;
  id: SplitterResizeTriggerProps["id"];
  label: string;
};

export function SplitterRoot(props: SplitterRootProps) {
  return (
    <ArkSplitter.Root
      class={props.class ?? "orbit-splitter"}
      classList={props.classList}
      defaultSize={props.defaultSize}
      onCollapse={props.onCollapse}
      onExpand={props.onExpand}
      orientation={props.orientation ?? "horizontal"}
      panels={props.panels}
    >
      {props.children}
    </ArkSplitter.Root>
  );
}

export function SplitterPanel(props: SplitterPanelProps) {
  return (
    <ArkSplitter.Panel class={props.class ?? "orbit-splitter__panel"} id={props.id}>
      {props.children}
    </ArkSplitter.Panel>
  );
}

export function SplitterHandle(props: SplitterHandleProps) {
  return (
    <ArkSplitter.ResizeTrigger
      class="orbit-splitter__handle"
      id={props.id}
      aria-label={props.label}
      disabled={props.disabled}
    >
      <ArkSplitter.ResizeTriggerIndicator class="orbit-splitter__handle-indicator" />
    </ArkSplitter.ResizeTrigger>
  );
}

export function SplitterContext(props: {
  children: (api: UseSplitterContext) => JSX.Element;
}) {
  return <ArkSplitter.Context>{props.children}</ArkSplitter.Context>;
}

export { useSplitterContext };
export type { UseSplitterContext };
