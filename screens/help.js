export async function helpScreen() {
    return `
    <div class="card" style="border-left: 4px solid #007bff; border-radius: 8px; padding: 20px;">
        <h2 style="color: #007bff; margin-top: 0; display:flex; align-items:center; gap:10px;">
            <span style="font-size:1.2em;">📘</span> Ajuda / Como Usar (FinanceApp)
        </h2>

        <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
            <h3 style="margin-top:0; color:#343a40;">1) Comece por aqui (primeiro uso)</h3>
            <ul style="margin: 0; padding-left: 20px; color: #495057; line-height: 1.6;">
                <li>Vá em Configurações:
                    <ul style="margin-top: 5px; margin-bottom: 5px;">
                        <li>Cadastre Pessoas (se usar), Contas (bancos) e Cartões (com fechamento/vencimento)</li>
                        <li>Cadastre Categorias/Subcategorias e Tags</li>
                        <li>Defina o câmbio USD→BRL (se usar USD)</li>
                    </ul>
                </li>
                <li><strong>Dica:</strong> Faça um “Export rápido (Pack iCloud)” depois de configurar tudo.</li>
            </ul>
        </div>

        <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
            <h3 style="margin-top:0; color:#343a40;">2) Rotina semanal (5–10 min)</h3>
            <ul style="margin: 0; padding-left: 20px; color: #495057; line-height: 1.6;">
                <li><strong>Importar:</strong>
                    <ul style="margin-top: 5px; margin-bottom: 5px;">
                        <li>Cartão: importe fatura (PDF/CSV/XLSX)</li>
                        <li>Conta: importe extrato (OFX/QIF/CSV)</li>
                    </ul>
                </li>
                <li><strong>Revisar:</strong>
                    <ul style="margin-top: 5px; margin-bottom: 5px;">
                        <li>Use “Confirmar sugestões (alta confiança)”</li>
                        <li>Use “Aplicar aos semelhantes”</li>
                        <li>Se ficar bom, “Salvar como regra”</li>
                    </ul>
                </li>
                <li><strong>Confirmar:</strong> finalize e confira no Painel/Relatórios.</li>
            </ul>
        </div>

        <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
            <h3 style="margin-top:0; color:#343a40;">3) Rotina da virada do mês (20–40 min)</h3>
            <ul style="margin: 0; padding-left: 20px; color: #495057; line-height: 1.6;">
                <li><strong>Contas a pagar:</strong>
                    <ul style="margin-top: 5px; margin-bottom: 5px;">
                        <li>Abra “Contas a Pagar”</li>
                        <li>Clique “Gerar/Atualizar mês” (com preview)</li>
                        <li>Pague/Parcial/Pule o que fizer sentido</li>
                    </ul>
                </li>
                <li><strong>Rejane (se aplicável):</strong>
                    <ul style="margin-top: 5px; margin-bottom: 5px;">
                        <li>Feche o mês da Rejane</li>
                        <li>Gere o Relatório (PDF) e copie a mensagem pronta</li>
                    </ul>
                </li>
                <li><strong>Fechamento mensal:</strong>
                    <ul style="margin-top: 5px; margin-bottom: 5px;">
                        <li>Gere “Fechamento Mensal (PDF)” para arquivar</li>
                    </ul>
                </li>
                <li><strong>Backup:</strong>
                    <ul style="margin-top: 5px; margin-bottom: 5px;">
                        <li>Faça “Export rápido (Pack iCloud)” para iCloud Drive</li>
                    </ul>
                </li>
            </ul>
        </div>

        <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
            <h3 style="margin-top:0; color:#343a40;">4) Investimentos (caixinhas/CDB/CDI)</h3>
            <ul style="margin: 0; padding-left: 20px; color: #495057; line-height: 1.6;">
                <li>Abra “Investimentos” ou “Bancos”</li>
                <li>Cadastre investimentos vinculados ao banco</li>
                <li><strong>Lançar:</strong>
                    <ul style="margin-top: 5px; margin-bottom: 5px;">
                        <li>Aporte (depósito)</li>
                        <li>Retirada</li>
                        <li>Rendimento (yield) — ex: CDI diário</li>
                    </ul>
                </li>
                <li><strong>Integração com conta (opcional):</strong>
                    <ul style="margin-top: 5px; margin-bottom: 5px;">
                        <li>Ao lançar aporte/retirada, pode criar “lançamento espelho” como Transferência</li>
                    </ul>
                </li>
                <li><strong>Acompanhar:</strong>
                    <ul style="margin-top: 5px; margin-bottom: 5px;">
                        <li>Rendimento do mês por banco</li>
                        <li>Performance (ROI simples)</li>
                        <li>Metas de Patrimônio (Reserva/Viagem)</li>
                    </ul>
                </li>
            </ul>
        </div>

        <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
            <h3 style="margin-top:0; color:#343a40;">5) Bancos (visão consolidada)</h3>
            <ul style="margin: 0; padding-left: 20px; color: #495057; line-height: 1.6;">
                <li>Em “Bancos”, veja por conta:
                    <ul style="margin-top: 5px; margin-bottom: 5px;">
                        <li>Patrimônio em investimentos</li>
                        <li>Aportes e rendimentos do mês</li>
                        <li>Ranking (mês/ano)</li>
                    </ul>
                </li>
                <li>Use cores/logos para facilitar identificação.</li>
            </ul>
        </div>

        <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
            <h3 style="margin-top:0; color:#343a40;">6) Painel (Dashboard)</h3>
            <ul style="margin: 0; padding-left: 20px; color: #495057; line-height: 1.6;">
                <li>Use como visão executiva:
                    <ul style="margin-top: 5px; margin-bottom: 5px;">
                        <li>Resumo do mês</li>
                        <li>Alertas (vencidos, fatura alta, dívidas, Rejane)</li>
                        <li>Checklist do mês</li>
                        <li>Orçamentos (limites) e Metas de Patrimônio</li>
                    </ul>
                </li>
            </ul>
        </div>

        <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
            <h3 style="margin-top:0; color:#343a40;">7) USD/BRL (sem cotação automática)</h3>
            <ul style="margin: 0; padding-left: 20px; color: #495057; line-height: 1.6;">
                <li>Defina taxa USD→BRL em Configurações</li>
                <li>Em lançamentos USD:
                    <ul style="margin-top: 5px; margin-bottom: 5px;">
                        <li>Pode preencher taxa fixa (fxRate) ou usar a taxa atual</li>
                    </ul>
                </li>
                <li><strong>Recalcular:</strong>
                    <ul style="margin-top: 5px; margin-bottom: 5px;">
                        <li>Use “Auditoria” para ver antes/depois</li>
                        <li>Por padrão, não recalcula transações com taxa fixa</li>
                    </ul>
                </li>
            </ul>
        </div>

        <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
            <h3 style="margin-top:0; color:#343a40;">8) Busca global</h3>
            <ul style="margin: 0; padding-left: 20px; color: #495057; line-height: 1.6;">
                <li>Use a tela “Buscar” para achar qualquer gasto:
                    <ul style="margin-top: 5px; margin-bottom: 5px;">
                        <li>Filtre por mês/intervalo, conta, cartão, categoria, tag, valor</li>
                        <li>Clique no resultado para abrir a tela correspondente</li>
                    </ul>
                </li>
            </ul>
        </div>

        <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
            <h3 style="margin-top:0; color:#343a40;">9) Orçamento x Metas (diferença)</h3>
            <ul style="margin: 0; padding-left: 20px; color: #495057; line-height: 1.6;">
                <li><strong>Orçamento:</strong> limite de gasto do mês por categoria/tag (alerta 80%/100%)</li>
                <li><strong>Meta de Patrimônio:</strong> objetivo de saldo (ex: Reserva 50k) usando investimentos</li>
            </ul>
        </div>

        <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
            <h3 style="margin-top:0; color:#343a40;">10) Backup/Restore (Pack iCloud)</h3>
            <ul style="margin: 0; padding-left: 20px; color: #495057; line-height: 1.6;">
                <li><strong>Export rápido:</strong> gera arquivo .financeapp (salve em iCloud Drive/FinanceApp)</li>
                <li><strong>Import rápido:</strong> restaura tudo com confirmação e validação</li>
                <li><strong>Regra de ouro:</strong> faça backup antes de grandes mudanças</li>
            </ul>
        </div>

        <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
            <h3 style="margin-top:0; color:#343a40;">11) Modo seguro (se travar)</h3>
            <ul style="margin: 0; padding-left: 20px; color: #495057; line-height: 1.6;">
                <li>Em Configurações:
                    <ul style="margin-top: 5px; margin-bottom: 5px;">
                        <li>“Modo seguro” limpa cache e service worker (não apaga seus dados)</li>
                        <li>Depois, clique em “Reiniciar app”</li>
                    </ul>
                </li>
            </ul>
        </div>

        <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 15px; margin-bottom: 25px;">
            <h3 style="margin-top:0; color:#343a40;">12) Se algo der errado (Troubleshooting rápido)</h3>
            <ul style="margin: 0; padding-left: 20px; color: #495057; line-height: 1.6;">
                <li><strong>Tela branca / botão travado:</strong>
                    <ul style="margin-top: 5px; margin-bottom: 5px;">
                        <li>Recarregue a página</li>
                        <li>Use o Modo seguro (nas configurações)</li>
                    </ul>
                </li>
                <li><strong>Ícones/manifest 404:</strong>
                    <ul style="margin-top: 5px; margin-bottom: 5px;">
                        <li>Reinstale o app no iPhone (Add to Home Screen de novo)</li>
                    </ul>
                </li>
                <li><strong>Import falhando:</strong>
                    <ul style="margin-top: 5px; margin-bottom: 5px;">
                        <li>Tente OFX/QIF/CSV alternativo</li>
                        <li>Confira o encoding/descrição (NAME vs MEMO) ao escolher o parser num import manual</li>
                    </ul>
                </li>
            </ul>
        </div>

        <hr style="border:0; border-top:1px solid #e9ecef; margin-bottom:20px;"/>
        <h3 style="text-align:center; color:#555; margin-top:0;">Atalhos Rápidos</h3>
        <div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-bottom: 20px;">
            <a href="#import" class="btn btn-secondary small" style="text-decoration:none;">📥 Importar</a>
            <a href="#invoices" class="btn btn-secondary small" style="text-decoration:none;">💳 Faturas</a>
            <a href="#tx" class="btn btn-secondary small" style="text-decoration:none;">🧾 Lançamentos</a>
            <a href="#bills" class="btn btn-secondary small" style="text-decoration:none;">🗓️ Contas a Pagar</a>
            <a href="#banks" class="btn btn-secondary small" style="text-decoration:none;">🏦 Bancos</a>
            <a href="#investments" class="btn btn-secondary small" style="text-decoration:none;">📈 Investimentos</a>
            <a href="#reports" class="btn btn-secondary small" style="text-decoration:none;">📊 Relatórios</a>
            <a href="#search" class="btn btn-secondary small" style="text-decoration:none;">🔍 Busca</a>
            <a href="#loans" class="btn btn-secondary small" style="text-decoration:none;">🤝 Empréstimos</a>
            <a href="#rejane-report" class="btn btn-secondary small" style="text-decoration:none;">📄 Relatório Rejane</a>
            <a href="#monthly-close" class="btn btn-secondary small" style="text-decoration:none;">📉 Fechamento Mensal</a>
            <a href="#annual-report" class="btn btn-secondary small" style="text-decoration:none;">📅 Relatório Anual</a>
        </div>
        
        <div style="text-align: center;">
            <button class="btn btn-primary" onclick="window.history.back()" style="padding: 10px 30px;">⬅ Voltar</button>
        </div>
    </div>
    `;
}
