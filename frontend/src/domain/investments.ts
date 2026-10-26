import type { Instrument, Position } from "@wealthos/api-client";

export function instrumentIndex(instruments: Instrument[]): Map<string, Instrument> {
  return new Map(instruments.map((instrument) => [instrument.instrument_id, instrument]));
}

export function positionInstrument(position: Position, instruments: Map<string, Instrument>): Instrument | undefined {
  return instruments.get(position.instrument_id);
}
