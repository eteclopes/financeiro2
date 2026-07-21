const { z } = require('zod');

// Senha flexível: apenas um comprimento mínimo é exigido (6 caracteres).
// Seguindo as diretrizes do NIST (SP 800-63B), exigir combinações de
// maiúsculas/números/símbolos tem pouco ganho real de segurança e piora
// bastante a usabilidade — o fator que mais importa é o comprimento.
const passwordSchema = z
  .string()
  .min(6, 'A senha deve ter pelo menos 6 caracteres.')
  .max(72, 'A senha deve ter no máximo 72 caracteres.');

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Nome muito curto.').max(120),
  email: z.string().trim().toLowerCase().email('E-mail inválido.'),
  password: passwordSchema,
});

// Só o nome é editável por aqui — trocar o e-mail exigiria reverificação
// (confirmação por e-mail, impacto em login) e não existe esse fluxo ainda.
const updateProfileSchema = z.object({
  name: z.string().trim().min(2, 'Nome muito curto.').max(120),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido.'),
  password: z.string().min(1, 'Senha é obrigatória.'),
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido.'),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token é obrigatório.'),
  password: passwordSchema,
});

module.exports = {
  registerSchema,
  updateProfileSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
};
