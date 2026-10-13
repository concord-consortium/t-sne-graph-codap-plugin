import React, { useState } from "react";
import { observer } from "mobx-react-lite";
import { Button } from "react-aria-components";
import { IPluginStore } from "../models/plugin-store";
import { useStore } from "../models/store-context";
import FitAllIcon from "../assets/fit-all.svg";
import ZoomInIcon from "../assets/zoom-in.svg";
import ZoomOutIcon from "../assets/zoom-out.svg";
import "./zoom-controls.scss";

export const zoomAnnouncement = (store: IPluginStore) => {
  const percent = `Zoom ${Math.round(store.scale * 100)}%`;
  return store.isFitView ? `${percent}, whole plot` : percent;
};

interface IZoomButtonProps {
  label: string;
  isDisabled: boolean;
  onPress: () => void;
  children: React.ReactNode;
}

// aria-disabled, not isDisabled, so a disabled button stays in the Tab order. Button takes no title,
// so a face that fills it carries the tooltip.
const ZoomButton = ({ label, isDisabled, onPress, children }: IZoomButtonProps) => (
  <Button className="zoom-button" aria-label={label} aria-disabled={isDisabled || undefined}
    onPress={() => { if (!isDisabled) onPress(); }}>
    <span className="zoom-button-face" title={label}>{children}</span>
  </Button>
);

/** Zoom in, zoom out and fit all, over the plot's top-left corner. */
export const ZoomControls = observer(() => {
  const store = useStore();
  const [announcement, setAnnouncement] = useState("");
  const { hasGraph } = store;

  const act = (action: () => void) => () => {
    action();
    setAnnouncement(zoomAnnouncement(store));
  };

  return (
    <div className="zoom-controls" role="group" aria-label="Zoom">
      <ZoomButton label="Zoom in" isDisabled={!hasGraph || !store.canZoomIn} onPress={act(store.zoomIn)}>
        <ZoomInIcon className="zoom-icon" aria-hidden="true" />
      </ZoomButton>
      <ZoomButton label="Zoom out" isDisabled={!hasGraph || !store.canZoomOut} onPress={act(store.zoomOut)}>
        <ZoomOutIcon className="zoom-icon" aria-hidden="true" />
      </ZoomButton>
      <ZoomButton label="Fit all" isDisabled={!hasGraph || store.isFitView} onPress={act(store.fitAll)}>
        <FitAllIcon className="zoom-icon" aria-hidden="true" />
      </ZoomButton>
      <p className="visually-hidden" aria-live="polite" data-testid="zoom-announcement">{announcement}</p>
    </div>
  );
});
