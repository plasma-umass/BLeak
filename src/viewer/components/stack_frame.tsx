import * as React from 'react';
import {IStackFrame} from '../../common/interfaces';
import {FileLocation} from '../model/interfaces';

interface StackFrameComponentProps {
  frame: IStackFrame;
  onStackFrameSelect: (sf: IStackFrame) => void;
  fileLocation: FileLocation;
}

function formatUrl(url: string): string {
  const lastSlash = url.lastIndexOf('/');
  if (lastSlash === -1) {
    return url;
  } else {
    return url.slice(lastSlash + 1);
  }
}

export default function StackFrame(p: StackFrameComponentProps) {
  const f = p.frame;
  const location = p.fileLocation;
  // Note: f[3] can be null.
  const functionName = f[3] ? f[3] : "(anonymous)";
  const url = formatUrl(f[0]);
  const line = f[1];
  const col = f[2];
  const selected = location.url === f[0] && location.line === line && location.column === col;
  return <button type="button" className={"list-group-item list-group-item-action" + (selected ? " selected" : "")} onClick={p.onStackFrameSelect.bind(null, p.frame)}>
    <span className="stack-frame"><span>{functionName}</span> <span>{url}:{line}:{col}</span></span>
  </button>;
}