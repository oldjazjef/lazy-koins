import { closedProjectProblem, isCanton } from './project';

describe('closedProjectProblem (F4.5)', () => {
  it('lets every change through while the project is open', () => {
    expect(
      closedProjectProblem({ status: 'in_progress' }, { name: 'Neu' }),
    ).toBeUndefined();
    expect(
      closedProjectProblem({ status: 'reviewed' }, { status: 'closed' }),
    ).toBeUndefined();
  });

  it('accepts reopening a closed project, and nothing else', () => {
    const closed = { status: 'closed' as const };
    expect(
      closedProjectProblem(closed, { status: 'in_progress' }),
    ).toBeUndefined();
    expect(
      closedProjectProblem(closed, { status: 'reviewed' }),
    ).toBeUndefined();
    expect(closedProjectProblem(closed, { name: 'Neu' })).toMatch(/closed/);
    expect(closedProjectProblem(closed, { status: 'closed' })).toMatch(
      /closed/,
    );
    expect(
      closedProjectProblem(closed, { status: 'in_progress', notes: 'x' }),
    ).toMatch(/closed/);
    expect(closedProjectProblem(closed, {})).toMatch(/closed/);
  });
});

describe('isCanton', () => {
  it('knows the Swiss cantons', () => {
    expect(isCanton('CH', 'ZH')).toBe(true);
    expect(isCanton('CH', 'AI')).toBe(true);
    expect(isCanton('CH', 'XX')).toBe(false);
    expect(isCanton('CH', 'zh')).toBe(false);
  });
});
