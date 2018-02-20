import * as React from 'react';
import Location from '../model/location';
import StackFrame from '../model/stack_frame';

interface StackFrameComponentProps {
  frame: StackFrame;
  onStackFrameSelect: (sf: StackFrame) => void;
  selectedLocation: Location;
}

function formatUrl(url: string): string {
  const lastSlash = url.lastIndexOf('/');
  if (lastSlash === -1) {
    return url;
  } else {
    return url.slice(lastSlash + 1);
  }
}

function nop() {}

export default function StackFrameComponent(p: StackFrameComponentProps) {
  const f = p.frame;
  const url = formatUrl(f.url);
  const line = f.line;
  const col = f.column;
  const location = p.selectedLocation;
  const selected = location.file === f.file && location.line === line && location.column === col;
  return <button type="button" className={"list-group-item list-group-item-action" + (selected ? " selected" : "")} onClick={p.frame.file ? p.onStackFrameSelect.bind(null, p.frame) : nop}>
    <span className="stack-frame"><span>{f.name}</span> <span>{url}</span><span>:{line}:{col}</span></span>
  </button>;
}