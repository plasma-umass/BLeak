import {IStackFrame} from '../../common/interfaces';
import * as React from 'react';
import StackFrameComponent from './stack_frame';
import {FileLocation} from '../model/interfaces';

interface StackTraceComponentProps {
  keyPrefix: string;
  stack: IStackFrame[];
  onStackFrameSelect: (sf: IStackFrame) => void;
  fileLocation: FileLocation;
}

export default function StackFrame(p: StackTraceComponentProps) {
  return <div className="list-group">
    {p.stack.map((f, i) => <StackFrameComponent fileLocation={p.fileLocation} onStackFrameSelect={p.onStackFrameSelect} key={`${p.keyPrefix}${i}`} frame={f} />)}
  </div>;
}