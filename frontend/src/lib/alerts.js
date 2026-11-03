import * as f from './format.js';
import { getStrategy } from './strategy.js';

/** Condição de uma regra ou de um evento de alerta, em texto: «Fecho acima de 15,00 €», «Sinal de compra da C-AI». */
export function alertCondition(rule) {
  if (rule.kind === 'signal') {
    const name = getStrategy(rule.strategy)?.name ?? rule.strategy;
    return rule.signalSide ? `Sinal de ${f.SIGNAL_SIDE_LABEL[rule.signalSide]} da ${name}` : `${f.ALERT_KIND_LABEL.signal} ${name}`;
  }
  const value = rule.kind.startsWith('close') ? f.money(rule.threshold, rule.currency || 'EUR') : `${f.number(rule.threshold)}%`;
  return `${f.ALERT_KIND_LABEL[rule.kind]} ${value}`;
}
