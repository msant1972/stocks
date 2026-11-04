import { AppError } from '../errors.js';

/** Erros da ligação à SAXO, no formato comum da API. Nenhum inclui tokens ou segredos. */
export const noToken = () => new AppError(409, 'SAXO_NO_TOKEN', 'não está ligado à SAXO Bank; ligue em Definições → SAXO Bank');
export const tokenExpired = () => new AppError(409, 'SAXO_TOKEN_EXPIRED', 'a ligação à SAXO Bank expirou ou foi recusada; volte a ligar em Definições → SAXO Bank');
export const liveBlocked = () => new AppError(409, 'SAXO_LIVE_BLOCKED', 'a conta real da SAXO Bank não está activada nesta aplicação (só simulação)');
export const forbidden = (msg) => new AppError(403, 'SAXO_FORBIDDEN', msg || 'a SAXO Bank recusou o acesso a este recurso');
export const rateLimited = () => new AppError(429, 'SAXO_RATE_LIMITED', 'limite de pedidos da SAXO Bank atingido; tente de novo daqui a alguns segundos');
export const duplicate = () => new AppError(409, 'SAXO_DUPLICATE', 'a SAXO Bank já recebeu uma ordem idêntica há instantes; aguarde 15 segundos antes de repetir');
export const rejected = (msg) => new AppError(422, 'SAXO_REJECTED', msg || 'a SAXO Bank recusou o pedido');
export const unavailable = (msg) => new AppError(502, 'SAXO_UNAVAILABLE', msg || 'a SAXO Bank não respondeu');
