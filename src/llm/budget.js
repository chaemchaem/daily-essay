// 일일 토큰·비용 상한. 실제 지출 시점의 한국 날짜 기준으로 누적한다.
// 상한에 가까워지면 검토 단계를 생략하는 대신 새 주제 생성을 멈추고 보류한다.
import { readInternal, writeInternal } from '../lib/store.js';
import { kstDateOf, nowMs } from '../lib/time.js';

export class BudgetExceededError extends Error {
  constructor(message) { super(message); this.code = 'budget_exceeded'; }
}

export class Budget {
  constructor(policy) {
    this.cap = policy.budget.dailyUsdCap;
    this.tokenCap = policy.budget.dailyOutputTokenCap;
    this.date = kstDateOf(nowMs());
    this.file = `ledger/budget-${this.date}.json`;
    this.state = readInternal(this.file, { date: this.date, usd: 0, usdUnknownCalls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, calls: 0 });
  }
  remainingUsd() { return this.cap - this.state.usd; }
  remainingOutputTokens() { return this.tokenCap - this.state.outputTokens; }
  /** 작업 단위(주제 1개 등)를 시작해도 되는지. 시작 후 중간에 끊기는 것을 막기 위해 미리 확인한다. */
  canAfford(estimatedUsd) {
    return this.remainingUsd() >= estimatedUsd && this.remainingOutputTokens() > 60000;
  }
  assertCall() {
    if (this.state.usd >= this.cap) throw new BudgetExceededError(`일일 비용 상한($${this.cap}) 도달`);
    if (this.state.outputTokens >= this.tokenCap) throw new BudgetExceededError(`일일 출력 토큰 상한(${this.tokenCap}) 도달`);
  }
  record(usage) {
    this.state.calls += 1;
    this.state.inputTokens += usage.inputTokens || 0;
    this.state.outputTokens += usage.outputTokens || 0;
    this.state.cacheReadTokens += usage.cacheReadTokens || 0;
    if (usage.costUsd == null) this.state.usdUnknownCalls += 1;
    else this.state.usd = Math.round((this.state.usd + usage.costUsd) * 10000) / 10000;
    writeInternal(this.file, this.state);
  }
}
