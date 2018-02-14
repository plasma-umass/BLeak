import * as React from 'react';
import StackFrameComponent from './stack_frame';
import Location from '../model/location';
import StackFrame from '../model/stack_frame';

interface StackTraceComponentProps {
  keyPrefix: string;
  stack: StackFrame[];
  onStackFrameSelect: (sf: StackFrame) => void;
  selectedLocation: Location;
}

export default function StackTrace(p: StackTraceComponentProps) {
  return <div className="list-group">
    {p.stack.map((f, i) => <StackFrameComponent selectedLocation={p.selectedLocation} onStackFrameSelect={p.onStackFrameSelect} key={`${p.keyPrefix}${i}`} frame={f} />)}
  </div>;
}