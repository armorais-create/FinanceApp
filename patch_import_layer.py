import os

def patch_importer():
    with open("utils/importer.js", "r") as f:
        text = f.read()

    text = text.replace(
        'const amountHeaders = ["valor", "value", "amount", "price", "vl", "r$", "brl", "vlr", "total", "montante", "valorbrl", "valor_final_brl", "quantia"];',
        'const amountHeaders = ["valor", "value", "amount", "price", "vl", "r$", "brl", "vlr", "total", "montante", "valorbrl", "valor_final_brl", "quantia"];\\n                    let last4 = null, cardName = null;\\n                    const l4Headers = ["cartão", "cartao", "final", "card"];\\n                    const nameHeaders = ["nome", "portador", "name", "titular"];\\n                    for (const h of l4Headers) if(r[h] !== undefined) { last4 = String(r[h]).trim(); break; }\\n                    for (const h of nameHeaders) if(r[h] !== undefined) { cardName = String(r[h]).trim(); break; }'
    )

    text = text.replace(
        'last4: null, cardName: null\\n                };',
        'last4, cardName\\n                };'
    )

    text = text.replace(
        'const desc = keys.descricao || keys.description || keys.historico || keys.estabelecimento || "Sem descrição";',
        'const desc = keys.descricao || keys.description || keys.historico || keys.estabelecimento || "Sem descrição";\\n                            const last4 = keys.cartão || keys.cartao || keys.final || keys.card || null;\\n                            const cardName = keys.nome || keys.portador || keys.name || keys.titular || null;'
    )

    text = text.replace(
        'selected: true, warnings: [], raw: r, cardName: null, last4: null',
        'selected: true, warnings: [], raw: r, cardName, last4'
    )

    with open("utils/importer.js", "w") as f:
        f.write(text)

def patch_import_ui():
    with open("screens/import.js", "r") as f:
        text = f.read()

    # Patch Step 1 password and auto-payer
    step1_old = """            setTimeout(async () => {
                try {
                    const result = await importer.parseFile(state.file, {
                        accountId: state.dest.importType === "account" ? state.dest.accountId : null
                    });

                    console.log(`[IMPORT][CSV] Parsed rows length: ${result.rows.length}`);
                    if (result.rows.length === 0) {
                        throw new Error("Nenhum item encontrado. Verifique se o arquivo é válido.");
                    }

                    // Map to internal state rows
                    state.rows = result.rows.map(r => {
                        let desc = r.description;
                        // Use raw text for initial description setup based on fallback preferences (only OFX/QIF have rawName/Memo)
                        if (state.dest.importType === "account" && r.rawMemo !== undefined) {
                            if (state.dest.descFallback === "name") desc = r.rawName || r.rawMemo || "Extrato OFX";
                            else if (state.dest.descFallback === "both") desc = [r.rawName, r.rawMemo].filter(Boolean).join(" - ") || "Extrato OFX";
                            else desc = r.rawMemo || r.rawName || "Extrato OFX";
                        }

                        return {
                            id: r.id,
                            date: r.dateISO, // Map dateISO -> date
                            description: desc,
                            rawName: r.rawName,
                            rawMemo: r.rawMemo,
                            value: r.amount, // Map amount -> value
                            currency: r.currency || "BRL",
                            fitid: r.fitid || "", // For OFX/QIF deduplication
                            categoryId: r.categoryId || "",
                            subcategoryId: r.subcategoryId || "",

                            cardType: r.cardUsageType || "fisico", // 'fisico' | 'virtual'
                            payerRole: r.payerRole || "main",      // 'main' | 'additional'
                            accountId: state.dest.importType === "account" ? state.dest.accountId : "",

                            selected: r.selected !== false,
                            warnings: r.warnings || [],
                            raw: r.raw
                        };
                    });

                    // --- APPLY RULES (Block 9B) ---
                    await applyRulesToStateRows();
                    // ------------------------------

                    state.step = 2;
                    renderDispatcher(cnt);
                } catch (err) {
                    console.error("[IMPORT][CSV] Error:", err);
                    alert("Erro ao ler arquivo: " + err.message);
                    btnNext.textContent = "Carregar e Visualizar »";
                    btnNext.disabled = false;
                }
            }, 50);"""

    step1_new = """            setTimeout(async () => {
                let pwd = undefined;
                let retry = true;
                while (retry) {
                    try {
                        const result = await importer.parseFile(state.file, {
                            accountId: state.dest.importType === "account" ? state.dest.accountId : null,
                            password: pwd
                        });
                        retry = false;

                        console.log(`[IMPORT][CSV] Parsed rows length: ${result.rows.length}`);
                        if (result.rows.length === 0) {
                            throw new Error("Nenhum item encontrado. Verifique se o arquivo é válido.");
                        }

                        state.rows = result.rows.map(r => {
                            let desc = r.description;
                            if (state.dest.importType === "account" && r.rawMemo !== undefined) {
                                if (state.dest.descFallback === "name") desc = r.rawName || r.rawMemo || "Extrato OFX";
                                else if (state.dest.descFallback === "both") desc = [r.rawName, r.rawMemo].filter(Boolean).join(" - ") || "Extrato OFX";
                                else desc = r.rawMemo || r.rawName || "Extrato OFX";
                            }

                            let matchedPersonId = "";
                            if (state.dest.importType === "card" && r.cardName) {
                                const first = r.cardName.trim().split(" ")[0].toLowerCase();
                                const pm = state.cache.people.find(p => p.name.toLowerCase().startsWith(first));
                                if (pm) matchedPersonId = pm.id;
                            }

                            return {
                                id: r.id,
                                date: r.dateISO,
                                description: desc,
                                rawName: r.rawName,
                                rawMemo: r.rawMemo,
                                value: r.amount,
                                currency: r.currency || "BRL",
                                fitid: r.fitid || "",
                                categoryId: r.categoryId || "",
                                subcategoryId: r.subcategoryId || "",
                                cardType: r.cardUsageType || "fisico",
                                payerRole: r.payerRole || "main",
                                personId: matchedPersonId,
                                accountId: state.dest.importType === "account" ? state.dest.accountId : "",
                                last4: r.last4,
                                cardName: r.cardName,
                                selected: r.selected !== false,
                                warnings: r.warnings || [],
                                raw: r.raw
                            };
                        });

                        await applyRulesToStateRows();

                        state.step = 2;
                        renderDispatcher(cnt);
                    } catch (err) {
                        if (err.message === "PASSWORD_REQUIRED") {
                            const p = prompt("Este PDF é protegido por senha. Por favor, digite a senha (ela não será salva):");
                            if (p) {
                                pwd = p;
                                continue;
                            } else {
                                alert("A importação foi cancelada pois a senha não foi fornecida.");
                                retry = false;
                            }
                        } else {
                            console.error("[IMPORT][CSV] Error:", err);
                            alert("Erro ao ler arquivo: " + err.message);
                            retry = false;
                        }
                        btnNext.textContent = "Carregar e Visualizar »";
                        btnNext.disabled = false;
                    }
                }
            }, 50);"""
    
    table_headers_old = """                        ${state.dest.importType === 'card' ? `
                            <th width="70">Parc.</th>
                            <th width="60">Atual</th>
                            <th width="80">Tipo</th>
                            <th width="90">Pagador</th>
                        ` : ''}"""
    
    table_headers_new = """                        ${state.dest.importType === 'card' ? `
                            <th width="80">Tipo</th>
                            <th width="110">Pagador</th>
                        ` : ''}"""

    table_row_old = """                <td>
                    <input type="text" class="rowDesc smallInput" data-idx="${i}" value="${esc(r.description)}" style="width:100%">
                    <div style="margin-top:2px;">${autoBadge} ${r.appliedRules && r.appliedRules.length ? `<span style="font-size:10px; color:#555;">(Regra aplicada)</span>` : ''}</div>
                </td>
                <td><input type="number" step="0.01" class="rowVal smallInput ${r.value === null ? 'error-input' : ''}" data-idx="${i}" value="${r.value === null ? '' : r.value}" placeholder="0.00" style="width:100%; box-sizing:border-box;"></td>
                
                <td>
                    <select class="rowCat smallInput" data-idx="${i}" style="width:100%">
                        ${catOptions}
                    </select>
                </td>
                <td>
                    <select class="rowSub smallInput" data-idx="${i}" style="width:100%">
                        ${subOptions}
                    </select>
                </td>
                
                ${state.dest.importType === 'card' ? `
                    <td>
                        <input type="number" class="rowTotalInst smallInput" data-idx="${i}" value="${r.totalInstallments || 1}" min="1" max="99" style="width:100%">
                    </td>
                    <td>
                        <input type="number" class="rowCurrInst smallInput" data-idx="${i}" value="${r.currentInstallment || 1}" min="1" max="99" style="width:100%">
                    </td>
                    <td>
                        <select class="rowType smallInput" data-idx="${i}" style="width:100%">
                            <option value="fisico" ${r.cardType === 'fisico' ? 'selected' : ''}>Físico</option>
                            <option value="virtual" ${r.cardType === 'virtual' ? 'selected' : ''}>Virtual</option>
                        </select>
                    </td>
                    <td>
                        <select class="rowPay smallInput" data-idx="${i}" style="width:100%">
                            <option value="main" ${r.payerRole === 'main' ? 'selected' : ''}>Titular</option>
                            <option value="additional" ${r.payerRole === 'additional' ? 'selected' : ''}>Adicional</option>
                        </select>
                    </td>
                ` : ''}"""

    table_row_new = """                <td>
                    <input type="text" class="rowDesc smallInput" data-idx="${i}" value="${esc(r.description)}" style="width:100%">
                    <div style="margin-top:2px;">
                        ${autoBadge} 
                        ${r.appliedRules && r.appliedRules.length ? `<span style="font-size:10px; color:#555;">(Regra aplicada)</span>` : ''}
                        ${state.dest.importType === 'card' && (r.cardName || r.last4) ? `<div style="font-size:10px; color:#666; margin-top:2px;">Cartão: ${r.last4 ? '****'+r.last4 : 'N/A'} • Nome: ${esc(r.cardName || 'N/D')}</div>` : ''}
                    </div>
                </td>
                <td><input type="number" step="0.01" class="rowVal smallInput ${r.value === null ? 'error-input' : ''}" data-idx="${i}" value="${r.value === null ? '' : r.value}" placeholder="0.00" style="width:100%; box-sizing:border-box;"></td>
                
                <td>
                    <select class="rowCat smallInput" data-idx="${i}" style="width:100%">
                        ${catOptions}
                    </select>
                </td>
                <td>
                    <select class="rowSub smallInput" data-idx="${i}" style="width:100%">
                        ${subOptions}
                    </select>
                </td>
                
                ${state.dest.importType === 'card' ? `
                    <td>
                        <select class="rowType smallInput" data-idx="${i}" style="width:100%">
                            <option value="fisico" ${r.cardType === 'fisico' ? 'selected' : ''}>Físico</option>
                            <option value="virtual" ${r.cardType === 'virtual' ? 'selected' : ''}>Virtual</option>
                        </select>
                    </td>
                    <td>
                        <select class="rowReqPerson smallInput" data-idx="${i}" style="width:100%">
                            <option value="">(Titular)</option>
                            ${state.cache.people.map(p => `<option value="${p.id}" ${r.personId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
                        </select>
                    </td>
                ` : ''}"""

    events_old = """        if (el.classList.contains("rowType")) row.cardType = el.value;
        if (el.classList.contains("rowPay")) row.payerRole = el.value;"""

    events_new = """        if (el.classList.contains("rowType")) row.cardType = el.value;
        if (el.classList.contains("rowReqPerson")) row.personId = el.value;"""

    debt_creation_old = """            if (state.dest.importType === "card") {
                // Card Export Structure
                finalTx = {
                    ...commonProps,
                    type: isExpense ? "expense" : "card_payment",

                    purchaseDate: row.date,
                    invoiceMonth: state.dest.invoiceMonth,
                    billMonth: state.dest.invoiceMonth,
                    cardId: state.dest.cardId,
                    cardType: row.cardType || "fisico",
                    cardHolder: (row.payerRole === "main" || row.payerRole === "additional")
                        ? row.payerRole : state.dest.cardHolder
                };
            }"""

    debt_creation_new = """            if (state.dest.importType === "card") {
                // Card Export Structure
                finalTx = {
                    ...commonProps,
                    type: isExpense ? "expense" : "card_payment",

                    purchaseDate: row.date,
                    invoiceMonth: state.dest.invoiceMonth,
                    billMonth: state.dest.invoiceMonth,
                    cardId: state.dest.cardId,
                    cardType: row.cardType || "fisico",
                    cardHolder: (row.payerRole === "main" || row.payerRole === "additional")
                        ? row.payerRole : state.dest.cardHolder
                };

                // Dívida a Receber Auto-Creation
                if (row.personId && row.personId !== "" && isExpense && absoluteValue > 0) {
                    const existingDebtId = uid("loan_impt");
                    const loan = {
                        id: existingDebtId,
                        title: `Ref: ${finalTx.description}`,
                        role: 'owed_to_me',
                        borrowerPersonId: row.personId,
                        lenderPersonId: "", 
                        principal: absoluteValue,
                        currency: finalTx.currency,
                        startDate: finalTx.date,
                        totalInstallments: 1,
                        installmentAmount: absoluteValue,
                        dueDay: parseInt(finalTx.date.split("-")[2], 10) || 10,
                        notes: `Gerado automaticamente da importação de cartão.\\nData: ${finalTx.date}\\nFatura: ${state.dest.invoiceMonth}`,
                        status: 'open',
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        import_session_id: state.importSessionId
                    };
                    try {
                        await put("loans", loan);
                        const inst = {
                            id: uid("loan_inst"),
                            loanId: loan.id,
                            installmentNo: 1,
                            installmentTotal: 1,
                            dueDate: loan.startDate,
                            amount: absoluteValue,
                            status: 'open',
                            createdAt: loan.createdAt
                        };
                        await put("loan_installments", inst);
                    } catch(er) {
                        console.warn("Could not auto-create debt receivable", er);
                    }
                }
            }"""

    text = text.replace(step1_old, step1_new)
    text = text.replace(table_headers_old, table_headers_new)
    text = text.replace(table_row_old, table_row_new)
    text = text.replace(events_old, events_new)
    text = text.replace(
        'if (el.classList.contains("rowTotalInst")) row.totalInstallments = parseInt(el.value) || 1;',
        '// Removed Parc'
    )
    text = text.replace(
        'if (el.classList.contains("rowCurrInst")) row.currentInstallment = parseInt(el.value) || 1;',
        '// Removed Atual'
    )
    text = text.replace(debt_creation_old, debt_creation_new)

    with open("screens/import.js", "w") as f:
        f.write(text)

patch_importer()
patch_import_ui()
print("PATCH_APPLIED")
