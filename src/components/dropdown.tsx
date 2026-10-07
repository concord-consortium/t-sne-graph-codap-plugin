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

// Option ids are strings, so a number key can't collide with one
const kClearKey = -1;

export const Dropdown = (props: IProps) => {
  const { label, options, value, onChange, placeholder = "Select", isDisabled, className } = props;
  const [isOpen, setIsOpen] = useState(false);

  // If the dropdown is disabled while its list is open, forget that it was open, so the list
  // doesn't reopen by itself when the dropdown is enabled again
  if (isDisabled && isOpen) setIsOpen(false);

  // Once a value is chosen, a leading "Select" item lets the user unselect it
  const items = value === undefined ? options : [{ id: kClearKey, label: "Select" }, ...options];

  const handleChange = (key: Key | null) => {
    // A disabled dropdown stays focusable, so ignore typing on its button
    if (isDisabled) return;
    onChange(key === null || key === kClearKey ? undefined : String(key));
  };

  // A disabled dropdown uses aria-disabled instead of isDisabled, which would take it out of the
  // Tab order; it is kept closed here instead
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
            <ListBoxItem className="dropdown-item" id={item.id} textValue={item.label}
              aria-label={item.id === kClearKey ? "Select, clear selection" : undefined}>
              {item.label}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </Select>
  );
};
