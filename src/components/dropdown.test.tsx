import React, { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dropdown, IDropdownOption } from "./dropdown";

const kOptions: IDropdownOption[] = [
  { id: "a", label: "A Data Table" },
  { id: "b", label: "Another Data Table" },
  { id: "c", label: "Even Another Table" }
];

// Holds the value the way the store will, and reports each change
const ControlledDropdown = (props: { initialValue?: string, isDisabled?: boolean, onChange?: jest.Mock,
                                     placeholder?: string }) => {
  const [value, setValue] = useState(props.initialValue);
  return (
    <Dropdown label="Data Table" options={kOptions} value={value} isDisabled={props.isDisabled}
      placeholder={props.placeholder} onChange={newValue => { setValue(newValue); props.onChange?.(newValue); }} />
  );
};

// While the list is open, React Aria hides the rest of the page from screen readers
const button = () => screen.getByRole("button", { name: /Data Table/, hidden: true });
const optionNames = () => within(screen.getByRole("listbox")).getAllByRole("option").map(option => option.textContent);

describe("Dropdown", () => {
  it("labels the button and shows the placeholder when nothing is selected", () => {
    render(<ControlledDropdown />);
    expect(button()).toHaveAccessibleName(/Data Table/);
    expect(button()).toHaveTextContent("Select");
    expect(button()).toHaveAttribute("aria-haspopup", "listbox");
    expect(button()).toHaveAttribute("aria-expanded", "false");
  });

  it("opens a listbox without a Select item while nothing is selected", async () => {
    const user = userEvent.setup();
    render(<ControlledDropdown />);
    await user.click(button());
    expect(button()).toHaveAttribute("aria-expanded", "true");
    expect(optionNames()).toEqual(["A Data Table", "Another Data Table", "Even Another Table"]);
  });

  it("selects an item with the mouse, closes the list, and shows the item", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<ControlledDropdown onChange={onChange} />);
    await user.click(button());
    await user.click(screen.getByRole("option", { name: "Another Data Table" }));
    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(button()).toHaveTextContent("Another Data Table");
  });

  it("adds a leading Select item once a value is chosen, which clears the value", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<ControlledDropdown initialValue="b" onChange={onChange} />);
    await user.click(button());
    expect(optionNames()).toEqual(["Select", "A Data Table", "Another Data Table", "Even Another Table"]);
    expect(screen.getByRole("option", { name: "Another Data Table" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("option", { name: "Select, clear selection" }));
    expect(onChange).toHaveBeenCalledWith(undefined);
    expect(button()).toHaveTextContent("Select");
    await user.click(button());
    expect(optionNames()).not.toContain("Select");
  });

  it("works with the keyboard alone", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<ControlledDropdown onChange={onChange} />);

    await user.tab();
    expect(button()).toHaveFocus();
    // Enter opens the list with the first item focused; arrows move; Enter selects and closes
    await user.keyboard("{Enter}");
    expect(screen.getByRole("option", { name: "A Data Table" })).toHaveFocus();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("b");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    // Focus returns to the button on the next animation frame
    await waitFor(() => expect(button()).toHaveFocus());

    // Reopening focuses the selected item; the Select item above it clears the value
    await user.keyboard("{Enter}");
    expect(screen.getByRole("option", { name: "Another Data Table" })).toHaveFocus();
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(screen.getByRole("option", { name: "Select, clear selection" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(button()).toHaveTextContent("Select");
  });

  it("closes with Escape without changing the value", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<ControlledDropdown initialValue="a" onChange={onChange} />);
    await user.click(button());
    await user.keyboard("{ArrowDown}{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(button()).toHaveTextContent("A Data Table");
  });

  it("uses Select for the clear item even when the placeholder differs", async () => {
    const user = userEvent.setup();
    render(<ControlledDropdown initialValue="a" placeholder="Select (optional)" />);
    await user.click(button());
    expect(optionNames()[0]).toBe("Select");
    await user.click(screen.getByRole("option", { name: "Select, clear selection" }));
    expect(button()).toHaveTextContent("Select (optional)");
  });

  it("stays in the Tab order while disabled, but doesn't open or change", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<ControlledDropdown isDisabled onChange={onChange} />);
    expect(button()).toHaveAttribute("aria-disabled", "true");
    expect(button()).not.toHaveAttribute("disabled");

    await user.tab();
    expect(button()).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("a");
    await user.click(button());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(button()).toHaveTextContent("Select");
  });

  it("opens once it is enabled", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Dropdown label="Data Table" options={kOptions} isDisabled onChange={jest.fn()} />);
    await user.click(button());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    rerender(<Dropdown label="Data Table" options={kOptions} onChange={jest.fn()} />);
    expect(button()).not.toHaveAttribute("aria-disabled");
    await user.click(button());
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("shows a saved value by name until its option has loaded", () => {
    const { rerender } = render(<Dropdown label="Data Table" options={[]} value="b" onChange={jest.fn()} />);
    expect(button()).toHaveTextContent("b");
    rerender(<Dropdown label="Data Table" options={kOptions} value="b" onChange={jest.fn()} />);
    expect(button()).toHaveTextContent("Another Data Table");
  });
});
