import React, { useState } from "react";
import { Button, Key, Label, ListBox, ListBoxItem, Popover, Select, SelectValue } from "react-aria-components";
import DropdownArrow from "../assets/dropdown-arrow.svg";
import "./dropdown.scss";

export interface IDropdownOption {
  id: string;
  label: string;
}

interface IProps {
  label: string;
  options: IDropdownOption[];
  value?: string;
  onChange: (value: string | undefined) => void;
  placeholder?: string;
  isDisabled?: boolean;
  className?: string;
}

// Option IDs are strings, so a number key can't collide with one
const kClearKey = -1;

export const Dropdown = (props: IProps) => {
  const { label, options, value, onChange, placeholder = "Select", isDisabled, className } = props;
  const [isOpen, setIsOpen] = useState(false);

  // If the dropdown is disabled while its list is open, forget that it was open, so the list
  // doesn't reopen by itself when the dropdown is enabled again
  if (isDisabled && isOpen) setIsOpen(false);

  // Once a value is chosen, the list starts with a "Select" item that clears it
  const items = value === undefined ? options : [{ id: kClearKey, label: "Select" }, ...options];

  const handleChange = (key: Key | null) => {
    // Typing on a disabled dropdown is ignored (see the aria-disabled note below)
    if (isDisabled) return;
    onChange(key === null || key === kClearKey ? undefined : String(key));
  };

  // A disabled dropdown uses aria-disabled, not React Aria's isDisabled, so it stays in the Tab
  // order and is announced as disabled. React Aria then treats it as enabled, so this component
  // keeps its list closed and ignores typing on it.
  return (
    <Select className={className ? `dropdown ${className}` : "dropdown"} value={value ?? null}
      onChange={handleChange} placeholder={placeholder}
      isOpen={isOpen && !isDisabled} onOpenChange={open => setIsOpen(open && !isDisabled)}>
      <Label className="dropdown-label">{label}</Label>
      <Button className="dropdown-button" aria-disabled={isDisabled || undefined}>
        <SelectValue className="dropdown-value">
          {/* A saved value shows its name until the options that include it have loaded */}
          {({ isPlaceholder, defaultChildren }) => isPlaceholder && value !== undefined ? value : defaultChildren}
        </SelectValue>
        <DropdownArrow className="dropdown-arrow" aria-hidden="true" />
      </Button>
      <Popover className="dropdown-popover" offset={2}>
        <ListBox className="dropdown-listbox" items={items}>
          {item => (
            // Typing on the closed button selects the first item whose textValue starts with the typed
            // letters. The "Select" item must never match, or typing "s" could clear the value.
            // Also, its textValue can't be empty, or React Aria uses the item's text, "Select".
            // A single space works as a stand-in, because React Aria never starts a search with a space.
            <ListBoxItem className="dropdown-item" id={item.id} textValue={item.id === kClearKey ? " " : item.label}
              aria-label={item.id === kClearKey ? "Select, clear selection" : undefined}>
              {item.label}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </Select>
  );
};
