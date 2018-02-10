declare module 'react-treeview' {
  import {Component, DetailedHTMLFactory, HTMLAttributes} from 'react';

  export interface TreeViewProps extends HTMLAttributes<HTMLDivElement> {
    collapsed?: boolean;
    defaultCollapsed?: boolean;
    nodeLabel: string | JSX.Element;
    className?: string;
    itemClassName?: string;
    childrenClassName?: string;
    treeViewClassName?: string;
  }

  export default class TreeView extends Component<TreeViewProps, {}> {}
}