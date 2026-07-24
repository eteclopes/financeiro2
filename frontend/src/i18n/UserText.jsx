/**
 * Envelope para QUALQUER texto digitado pelo usuário.
 *
 * O i18n deste projeto traduz reescrevendo o DOM (ver I18nBridge). O
 * dicionário contém termos que também são palavras comuns — "Salário",
 * "Alimentação", "Viagens". Resultado: uma receita chamada "Salário"
 * aparecia como "Salary" em inglês. O dado no banco continuava certo, mas
 * a tela mostrava outra coisa, e o CSV exportado (que lê a API direto)
 * discordava da tela.
 *
 * Não dá para resolver isso comparando strings: o mesmo texto pode ser
 * rótulo da interface OU conteúdo do usuário. A separação precisa ser
 * ESTRUTURAL — por isso marcamos a região no DOM.
 *
 * Use sempre que renderizar: descrição, observação, nome de meta, de
 * caixinha, de cartão, de dívida, de categoria personalizada.
 */
export function UserText({ children, as: Tag = 'span', className = '', ...props }) {
  return (
    <Tag data-i18n-ignore="true" className={className} {...props}>
      {children}
    </Tag>
  );
}

export default UserText;
