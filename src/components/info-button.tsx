import React from "react";
import { Button } from "react-aria-components";
import InfoIcon from "../assets/info.svg";
import "./info-button.scss";

export const kInfoButtonLabel = "Information about t-SNE plots";

interface IProps {
  onPress: () => void;
}

// Button takes no title, so the face has it
export const InfoButton = ({ onPress }: IProps) => (
  <Button className="info-button" aria-label={kInfoButtonLabel} onPress={onPress}>
    <span className="info-button-face" title={kInfoButtonLabel}>
      <InfoIcon className="info-icon" aria-hidden="true" />
    </span>
  </Button>
);
