// Prisma usa BigInt para colunas BIGINT (todos os IDs do sistema).
// JSON.stringify nativo não sabe serializar BigInt e lança TypeError.
// Centralizamos esse patch aqui, importado uma única vez no app.js,
// em vez de converter manualmente em cada controller.
if (typeof BigInt.prototype.toJSON !== 'function') {
  BigInt.prototype.toJSON = function toJSON() {
    return this.toString();
  };
}
