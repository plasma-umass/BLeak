import {HeapSnapshotContents} from '../common/interfaces';

const enum ParserState {
  // The parser has encountered an error and can no longer proceed.
  ERROR = 0,
  // Special mode for the snapshot line.
  SNAPSHOT_LINE,
  // Waiting for the beginning of an array property, e.g. "field":[
  ARRAY_PROPERTY_BEGIN,
  // Waiting for more numbers in an array property, or the end of the array property.
  NUMBER_ARRAY,
  // Waiting for more strings in an array property.
  STRING_ARRAY,
  // Waiting for end of snapshot.
  END
}

export const enum DataTypes {
  SNAPSHOT = 1,
  NODES = 2,
  EDGES = 3,
  STRINGS = 4
}

type ParserEvent = SnapshotEvent | NumbersEvent | StringsEvent;

interface SnapshotEvent {
  type: DataTypes.SNAPSHOT;
  data: HeapSnapshotContents;
}

interface NumbersEvent {
  type: DataTypes.NODES | DataTypes.EDGES;
  data: number[];
}

interface StringsEvent {
  type: DataTypes.STRINGS;
  data: string[];
}

const SNAPSHOT_PROP_NAME = `{"snapshot":`;

function onSnapshotChunk() {

}

/**
 * Streaming parser for heap snapshots.
 *
 * Here's how the snapshot is streamed from Chrome (newlines included!):
 *
 * {"snapshot":{"meta":{"node_fields":["type","name","id","self_size","edge_count","trace_node_id"],"node_types":[["hidden","array","string","object","code","closure","regexp","number","native","synthetic","concatenated string","sliced string"],"string","number","number","number","number","number"],"edge_fields":["type","name_or_index","to_node"],"edge_types":[["context","element","property","internal","hidden","shortcut","weak"],"string_or_number","node"],"trace_function_info_fields":["function_id","name","script_name","script_id","line","column"],"trace_node_fields":["id","function_info_index","count","size","children"],"sample_fields":["timestamp_us","last_assigned_id"]},"node_count":931835,"edge_count":4713209,"trace_function_count":0},
 * "nodes":[9,1,1,0,6,0
 * ,9,2,3,0,17,0
 * [etc]
 * ],
 * "edges":[1,1,6
 * ,1,1,22824
 * [etc]
 * ],
 * "trace_function_infos":[],
 * "trace_tree":[],
 * "samples":[],
 * "strings":["<dummy>",
 * "[string value, which may have newlines! \ is escape character]",
 * "98272"]}
 *
 * The parser assumes the snapshot is in this format, and that the first chunk contains the entire "snapshot" property.
 */
export default class HeapSnapshotParser {
  public static FromString(data: string): HeapSnapshotParser {
    const rv = new HeapSnapshotParser();
    rv.addSnapshotChunk(data);
    return rv;
  }

  private _state: ParserState = ParserState.SNAPSHOT_LINE;
  private _error: Error = null;
  private _activeProperty: string = null;
  private _pendingEvents: ParserEvent[] = [];
  private _pendingReads: { resolve: (e: ParserEvent) => void, reject: (e: Error) => void }[] = [];
  private _buffer: string = "";

  private _onSnapshotChunk: (chunk: string, end: boolean) => void = onSnapshotChunk;
  public set onSnapshotChunk(v: (chunk: string, end: boolean) => void) {
    this._onSnapshotChunk = v;
  }

  /**
   * Adds another snapshot chunk to parse.
   * @param chunk
   */
  public addSnapshotChunk(chunk: string): void {
    this._buffer += chunk;
    this._parse();
    this._onSnapshotChunk(chunk, this._state === ParserState.END);
  }

  private _parse(): void {
    const chunk = this._buffer;
    const chunkLen = chunk.length;
    let chunkPosition = 0;

    outerLoop:
    while (!this.hasErrored() && chunkPosition < chunkLen) {
      switch (this._state) {
        case ParserState.SNAPSHOT_LINE: {
          // Expecting: {"snapshot":{[object here]},\n
          const beginString = chunk.slice(chunkPosition, chunkPosition + SNAPSHOT_PROP_NAME.length);
          if (beginString !== SNAPSHOT_PROP_NAME) {
            this._raiseError(new Error(`Unable to find "snapshot" property in first chunk.`));
            break outerLoop;
          }
          chunkPosition += SNAPSHOT_PROP_NAME.length;

          let startIndex = chunkPosition;
          let endingIndex = -1;
          for (; chunkPosition < chunkLen; chunkPosition++) {
            if (chunk[chunkPosition] === "\n") {
              // - 1 to cut off the comma
              endingIndex = chunkPosition - 1;
              chunkPosition++;
              break;
            }
          }
          if (endingIndex === -1) {
            this._raiseError(new Error(`Unable to find whole "snapshot" object in first snapshot chunk.`));
            break outerLoop;
          }

          try {
            const snapshot: HeapSnapshotContents = JSON.parse(chunk.slice(startIndex, endingIndex));
            this._pendingEvents.push({
              type: DataTypes.SNAPSHOT,
              data: snapshot
            });
            this._state = ParserState.ARRAY_PROPERTY_BEGIN;
          } catch (e) {
            this._raiseError(e);
            break outerLoop;
          }
          break;
        }
        case ParserState.ARRAY_PROPERTY_BEGIN: {
          const start = chunkPosition;
          for (; chunkPosition < chunk.length && chunk[chunkPosition] !== "["; chunkPosition++) {
            // Wait.
          }

          if (chunkPosition >= chunk.length) {
            this._raiseError(new Error(`Unable to locate the beginning of a property.`));
            break outerLoop;
          }
          // Skip over "[".
          chunkPosition++;

          // [start, chunkPosition) should be string `"propname":[`
          this._activeProperty = chunk.slice(start + 1, chunkPosition - 3);

          if (this._activeProperty === "strings") {
            this._state = ParserState.STRING_ARRAY;
          } else {
            this._state = ParserState.NUMBER_ARRAY;
          }
          break;
        }
        case ParserState.NUMBER_ARRAY: {
          const start = chunkPosition;
          let lastNewline = start;
          numberForLoop:
          for (; chunkPosition < chunkLen; chunkPosition++) {
            switch (chunk[chunkPosition]) {
              case "]":
                // End of array.
                break numberForLoop;
              case "\n":
                lastNewline = chunkPosition;
                break;
            }
          }
          const arrayEnded = chunkPosition !== chunkLen;
          // [start, end) is either:
          // - "" if the array is zero-length,
          // - "9,3,4,5\n,1,2,3[etc]" if this is the start of the array,
          // - ",1,2,3,4" if this is the middle of the array
          // It does not contain the "]" character.
          const end = arrayEnded ? chunkPosition : lastNewline;
          if (start !== end) {
            const beginningComma = chunk[start] === ",";
            const numberChunk = chunk.slice(beginningComma ? start + 1 : start, end);
            const numbers: number[] = JSON.parse(`[${numberChunk}]`);
            switch (this._activeProperty) {
              case "nodes":
                this._pendingEvents.push({
                  type: DataTypes.NODES,
                  data: numbers
                });
                break;
              case "edges":
                this._pendingEvents.push({
                  type: DataTypes.EDGES,
                  data: numbers
                });
                break;
            }
          }

          if (arrayEnded) {
            // Skip "]".
            chunkPosition++;
            switch (chunk[chunkPosition]) {
              case ",":
                this._state = ParserState.ARRAY_PROPERTY_BEGIN;
                // Skip , and \n
                chunkPosition += 2;
                break;
              case "}":
                this._state = ParserState.END;
                break;
              default:
                this._raiseError(new Error(`Unrecognized end-of-array character: ${chunk[chunkPosition]}`));
                break;
            }
            break;
          } else {
            // Skip \n
            chunkPosition = lastNewline + 1;
            break outerLoop;
          }
        }
        case ParserState.STRING_ARRAY: {
          const start = chunkPosition;
          let escaped = false;
          let lastStringEnding = start;
          let isInString = false;
          // Look for unescaped "]", which ends the array.
          stringWhile:
          while (chunkPosition < chunkLen) {
            switch (chunk[chunkPosition]) {
              case '"':
                if (!escaped) {
                  isInString = !isInString;
                  if (!isInString) {
                    lastStringEnding = chunkPosition;
                  }
                }
                escaped = false;
                break;
              case ']':
                if (!isInString) {
                  break stringWhile;
                }
                escaped = false;
                break;
              case '\\':
                // Flip, for sequences of "\" (e.g. an actual \ character)
                escaped = !escaped;
                break;
              default:
                escaped = false;
                break;
            }
            chunkPosition++;
          }
          const arrayEnded = chunkPosition !== chunkLen;
          // [start, end) is either:
          // - "" if the array is zero-length,
          // - "9,3,4,5\n,1,2,3[etc]" if this is the start of the array,
          // - ",1,2,3,4" if this is the middle of the array
          // It does not contain the "]" character.
          const end = arrayEnded ? chunkPosition : lastStringEnding + 1;
          if (start !== end) {
            const beginningComma = chunk[start] === ",";
            const stringChunk = chunk.slice(beginningComma ? start + 1 : start, end);
            const strings: string[] = JSON.parse(`[${stringChunk}]`);
            this._pendingEvents.push({
              type: DataTypes.STRINGS,
              data: strings
            });
          }
          if (arrayEnded) {
            // Skip "]".
            chunkPosition++;
            switch (chunk[chunkPosition]) {
              case ",":
                this._state = ParserState.ARRAY_PROPERTY_BEGIN;
                break;
              case "}":
                this._state = ParserState.END;
                break;
              default:
                this._raiseError(new Error(`Unrecognized end-of-array character: ${chunk[chunkPosition]}`));
                break;
            }
          } else {
            chunkPosition = lastStringEnding + 1;
            break outerLoop;
          }
          break;
        }
        case ParserState.END:
          if (chunk[chunkPosition] !== '}') {
            this._raiseError(new Error(`Unexpected end of snapshot: ${chunk[chunkPosition]}`));
            break outerLoop;
          }
          chunkPosition++;
          this._pendingEvents.push(null);
          break outerLoop;
        case ParserState.ERROR:
          break outerLoop;
        default:
          this._raiseError(new Error(`Invalid state: ${this._state}`));
          break outerLoop;
      }
    }

    if (chunkPosition < chunkLen && this._state !== ParserState.STRING_ARRAY && this._state !== ParserState.NUMBER_ARRAY && !this.hasErrored()) {
      this._raiseError(new Error(`Parsing error: Did not consume whole chunk!`));
    }

    if (chunkPosition < chunkLen) {
      this._buffer = chunk.slice(chunkPosition);
    } else {
      this._buffer = "";
    }

    this._processPendingPromises();
  }

  private _processPendingPromises(): void {
    const hasErrored = this.hasErrored();
    while (!hasErrored && this._pendingReads.length > 0 && this._pendingEvents.length > 0) {
      this._pendingReads.shift().resolve(this._pendingEvents.shift());
    }

    if (hasErrored) {
      for (const promise of this._pendingReads) {
        promise.reject(this._error);
      }
      this._pendingReads = [];
    } else if (this._pendingEvents.length === 0 && this._state === ParserState.END) {
      for (const promise of this._pendingReads) {
        promise.resolve(null);
      }
      this._pendingReads = [];
    }
  }

  private _raiseError(e: Error): void {
    this._error = e;
    this._state = ParserState.ERROR;
    this._processPendingPromises();
  }

  public hasErrored(): boolean {
    return this._state === ParserState.ERROR;
  }

  public read(): Promise<ParserEvent> {
    if (this._pendingEvents.length > 0) {
      return Promise.resolve(this._pendingEvents.shift());
    } else {
      return new Promise<ParserEvent>((resolve, reject) => {
        this._pendingReads.push({resolve, reject});
      });
    }
  }
}