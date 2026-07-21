import { Splitter as ArkSplitter } from "@ark-ui/solid/splitter";
import type { SplitterResizeTriggerProps, SplitterRootProps as ArkSplitterRootProps } from "@ark-ui/solid/splitter";
import type { JSX } from "solid-js";

type SplitterRootProps = {
  children: JSX.Element;
  class?: string;
  defaultSize?: ArkSplitterRootProps["defaultSize"];
  orientation?: "horizontal" | "vertical";
  panels: ArkSplitterRootProps["panels"];
};

type SplitterPanelProps = {
  children: JSX.Element;
  class?: string;
  id: string;
};

type SplitterHandleProps = {
  id: SplitterResizeTriggerProps["id"];
  label: string;
};

export function SplitterRoot(props: SplitterRootProps) {
  return (
    <ArkSplitter.Root
      class={props.class ?? "orbit-splitter"}
      defaultSize={props.defaultSize}
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
    <ArkSplitter.ResizeTrigger class="orbit-splitter__handle" id={props.id} aria-label={props.label}>
      <ArkSplitter.ResizeTriggerIndicator class="orbit-splitter__handle-indicator" />
    </ArkSplitter.ResizeTrigger>
  );
}
