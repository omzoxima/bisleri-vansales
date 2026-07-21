import { DayState } from '../shared';

/**
 * The day-state machine. Enforced in ONE place on the device and re-validated
 * by the API — eliminates the whole UAT bug family of "end day before start",
 * "transfer without day start", "demand without day start", "double day end".
 */

const ORDERING: DayState[] = [
  'logged_in',
  'gate_pass_verified',
  'day_started',
  'demand_created',
  'settled',
  'day_ended',
];

export type DayAction =
  | 'verify_gate_pass'
  | 'start_day'
  | 'start_visit'
  | 'book_order'
  | 'collect_payment'
  | 'collect_jars'
  | 'foc'
  | 'replacement'
  | 'van_transfer'
  | 'create_demand'
  | 'edit_demand'
  | 'run_settlement'
  | 'end_day';

/** Minimum state required for each action. */
const REQUIRED: Record<DayAction, DayState> = {
  verify_gate_pass: 'logged_in',
  start_day: 'gate_pass_verified',
  start_visit: 'day_started',
  book_order: 'day_started',
  collect_payment: 'day_started',
  collect_jars: 'day_started',
  foc: 'day_started',
  replacement: 'day_started',
  van_transfer: 'day_started',
  create_demand: 'day_started',
  edit_demand: 'demand_created',
  run_settlement: 'demand_created',
  end_day: 'settled',
};

/** Actions blocked once the day has ended. */
const BLOCKED_AFTER_END: DayAction[] = [
  'verify_gate_pass',
  'start_day',
  'start_visit',
  'book_order',
  'collect_payment',
  'collect_jars',
  'foc',
  'replacement',
  'van_transfer',
  'create_demand',
  'run_settlement',
  'end_day',
];

export function stateIndex(state: DayState): number {
  return ORDERING.indexOf(state);
}

export function canPerform(state: DayState, action: DayAction): boolean {
  if (state === 'day_ended' && BLOCKED_AFTER_END.includes(action)) return false;
  return stateIndex(state) >= stateIndex(REQUIRED[action]);
}

export function assertCan(state: DayState, action: DayAction): void {
  if (!canPerform(state, action)) {
    throw new DayStateError(state, action);
  }
}

export class DayStateError extends Error {
  constructor(
    public readonly state: DayState,
    public readonly action: DayAction,
  ) {
    super(guardMessage(state, action));
    this.name = 'DayStateError';
  }
}

export function guardMessage(state: DayState, action: DayAction): string {
  if (state === 'day_ended') return 'Your day has ended — no further transactions today.';
  switch (REQUIRED[action]) {
    case 'gate_pass_verified':
      return 'Verify your gate pass first.';
    case 'day_started':
      return 'Start your day before doing this.';
    case 'demand_created':
      return 'Create tomorrow’s check-in demand first.';
    case 'settled':
      return 'Settlement must balance before you can end the day.';
    default:
      return `Not allowed in state ${state}.`;
  }
}

/** Valid forward transitions. */
export function nextState(state: DayState, event: DayAction): DayState | null {
  switch (event) {
    case 'verify_gate_pass':
      return state === 'logged_in' ? 'gate_pass_verified' : null;
    case 'start_day':
      return state === 'gate_pass_verified' ? 'day_started' : null;
    case 'create_demand':
      return state === 'day_started' ? 'demand_created' : null;
    case 'run_settlement':
      return state === 'demand_created' ? 'settled' : null;
    case 'end_day':
      return state === 'settled' ? 'day_ended' : null;
    default:
      return null;
  }
}
