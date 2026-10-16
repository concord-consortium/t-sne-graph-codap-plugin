import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InfoButton, kInfoButtonLabel } from "./info-button";

const infoButton = () => screen.getByRole("button", { name: "Information about t-SNE plots" });

describe("InfoButton", () => {
  it("has a name and a matching tooltip", () => {
    render(<InfoButton onPress={jest.fn()} />);
    expect(infoButton()).toHaveAttribute("aria-label", kInfoButtonLabel);
    expect(within(infoButton()).getByTitle(kInfoButtonLabel)).toBeInTheDocument();
  });

  it("calls onPress on a click, Enter and Space", async () => {
    const user = userEvent.setup();
    const onPress = jest.fn();
    render(<InfoButton onPress={onPress} />);
    await user.click(infoButton());
    expect(onPress).toHaveBeenCalledTimes(1);
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onPress).toHaveBeenCalledTimes(3);
  });

  it("sets the hover, pressed and keyboard focus attributes the styles use", async () => {
    const user = userEvent.setup();
    render(<InfoButton onPress={jest.fn()} />);
    await user.hover(infoButton());
    expect(infoButton()).toHaveAttribute("data-hovered");
    await user.pointer({ keys: "[MouseLeft>]", target: infoButton() });
    expect(infoButton()).toHaveAttribute("data-pressed");
    await user.pointer({ keys: "[/MouseLeft]", target: infoButton() });
    expect(infoButton()).not.toHaveAttribute("data-pressed");
    // Focused by the click, but not keyboard focus
    expect(infoButton()).toHaveFocus();
    expect(infoButton()).not.toHaveAttribute("data-focus-visible");
    await user.unhover(infoButton());
    await user.tab({ shift: true });
    await user.tab();
    expect(infoButton()).toHaveFocus();
    expect(infoButton()).toHaveAttribute("data-focus-visible");
  });
});
