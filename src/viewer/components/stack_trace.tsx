import {IStackFrame} from '../../common/interfaces';
import * as React from 'react';
import StackFrameComponent from './stack_frame';

interface StackTraceComponentProps {
  keyPrefix: string;
  stack: IStackFrame[];
}

export default function StackFrame(p: StackTraceComponentProps) {
  return <div className="list-group">
    {p.stack.map((f, i) => <StackFrameComponent key={`${p.keyPrefix}${i}`} frame={f} />)}
  </div>;
}