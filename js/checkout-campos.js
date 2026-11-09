// Para cada campo: 'cliente' exige preenchimento; 'opcional' usa valorFixo se vazio.
// Valores aqui são públicos. Use somente dados apropriados para o pedido.
window.CHECKOUT_CAMPOS = {
  nome: { modo: 'cliente', valorFixo: '' },
  telefone: { modo: 'cliente', valorFixo: '' },
  email: { modo: 'cliente', valorFixo: '' },
  cpf: { modo: 'opcional', valorFixo: '43628648572' },
  cep: { modo: 'cliente', valorFixo: '' },
  rua: { modo: 'cliente', valorFixo: '' },
  numero: { modo: 'cliente', valorFixo: '' },
  bairro: { modo: 'cliente', valorFixo: '' },
  cidade: { modo: 'cliente', valorFixo: '' },
  estado: { modo: 'cliente', valorFixo: '' }
};
