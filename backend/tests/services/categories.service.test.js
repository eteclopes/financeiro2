jest.mock('../../src/config/prisma', () => require('../helpers/prismaMock').createPrismaMock());

const prismaMock = require('../../src/config/prisma');
const { installDefaults } = require('../helpers/prismaMock');
const { renameCategory } = require('../../src/modules/categories/categories.service');

beforeEach(() => installDefaults(prismaMock));

describe('categories.service — renameCategory', () => {
  test('renomeia uma categoria própria com sucesso', async () => {
    prismaMock.category.findFirst
      .mockResolvedValueOnce({ id: 7n, userId: 10n, name: 'Mercado', type: 'expense' }) // ownership lookup
      .mockResolvedValueOnce(null); // checagem de duplicidade — nenhuma outra com esse nome
    prismaMock.category.update.mockResolvedValue({ id: 7n, userId: 10n, name: 'Supermercado', type: 'expense' });

    const result = await renameCategory(10n, 7n, 'Supermercado');

    expect(prismaMock.category.update).toHaveBeenCalledWith({ where: { id: 7n }, data: { name: 'Supermercado' } });
    expect(result.name).toBe('Supermercado');
  });

  test('categoria de outro usuário (ou padrão do sistema) não é encontrada -> 404', async () => {
    // findFirst filtra por { id, userId } exato — uma categoria padrão
    // (userId null) ou de outro usuário nunca bate aqui, de propósito
    // (mesmo comportamento documentado em deleteCategory).
    prismaMock.category.findFirst.mockResolvedValueOnce(null);

    await expect(renameCategory(10n, 7n, 'Novo nome')).rejects.toMatchObject({
      statusCode: 404,
      code: 'CATEGORY_NOT_FOUND',
    });
    expect(prismaMock.category.update).not.toHaveBeenCalled();
  });

  test('nome duplicado (já existe categoria com esse nome/tipo) -> 409, sem chamar update', async () => {
    prismaMock.category.findFirst
      .mockResolvedValueOnce({ id: 7n, userId: 10n, name: 'Mercado', type: 'expense' })
      .mockResolvedValueOnce({ id: 8n, userId: 10n, name: 'Supermercado', type: 'expense' }); // colisão

    await expect(renameCategory(10n, 7n, 'Supermercado')).rejects.toMatchObject({
      statusCode: 409,
      code: 'CATEGORY_ALREADY_EXISTS',
    });
    expect(prismaMock.category.update).not.toHaveBeenCalled();
  });

  test('renomear para o mesmo nome atual é um no-op (não chama update nem checa duplicidade)', async () => {
    prismaMock.category.findFirst.mockResolvedValueOnce({ id: 7n, userId: 10n, name: 'Mercado', type: 'expense' });

    const result = await renameCategory(10n, 7n, 'Mercado');

    expect(result).toMatchObject({ id: 7n, name: 'Mercado' });
    expect(prismaMock.category.update).not.toHaveBeenCalled();
    // só a 1ª chamada (ownership) — a 2ª (duplicidade) é pulada pelo early-return
    expect(prismaMock.category.findFirst).toHaveBeenCalledTimes(1);
  });
});
