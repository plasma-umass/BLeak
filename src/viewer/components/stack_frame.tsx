import * as React from 'react';
import {IStackFrame} from '../../common/interfaces';

interface StackFrameComponentProps {
  frame: IStackFrame;
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
  // Note: f[3] can be null.
  const functionName = f[3] ? f[3] : "(anonymous)";
  const url = formatUrl(f[0]);
  const line = f[1];
  const col = f[2];
  return <button type="button" className="list-group-item list-group-item-action">
    <span className="stack-frame"><span>{functionName}</span> <span>{url}:{line}:{col}</span></span>
  </button>;
}