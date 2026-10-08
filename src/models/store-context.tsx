import React, { createContext, ReactNode, useContext } from "react";
import { IPluginStore } from "./plugin-store";

const StoreContext = createContext<IPluginStore | undefined>(undefined);

interface IProps {
  store: IPluginStore;
  children: ReactNode;
}

export const StoreProvider = ({ store, children }: IProps) => (
  <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
);

export const useStore = () => {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error("useStore must be used inside a StoreProvider");
  }
  return store;
};
