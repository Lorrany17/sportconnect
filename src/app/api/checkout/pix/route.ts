import { NextResponse } from "next/server";
import { MercadoPagoConfig, Payment } from "mercadopago";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAuthenticatedUser } from "@/lib/serverAuth";

// 1. Configuração do SDK do Mercado Pago V2
const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || "",
});
const payment = new Payment(client);

export async function POST(request: Request) {
  try {
    // 0. Autenticação estrita do usuário
    const authHeader = request.headers.get("authorization");
    const explicitToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    let authUser;
    try {
      authUser = await requireAuthenticatedUser(explicitToken);
    } catch (authErr: unknown) {
      const msg = authErr instanceof Error ? authErr.message : "401 Unauthorized: Usuário não autenticado.";
      return NextResponse.json(
        { error: msg },
        { status: 401 }
      );
    }

    // 2. Receber o body da requisição
    const body = await request.json().catch(() => ({}));
    const {
      tournamentId,
      teamId,
      teamName,
      email,
    } = body;

    if (!tournamentId || !teamId) {
      return NextResponse.json(
        { error: "tournamentId e teamId são obrigatórios." },
        { status: 400 }
      );
    }

    const adminClient = getSupabaseAdmin();

    // 2.1 Buscar dados da equipe e validar titularidade
    const { data: team, error: teamErr } = await adminClient
      .from("teams")
      .select("id, name, tournament_id, user_id")
      .eq("id", teamId)
      .maybeSingle();

    if (teamErr || !team) {
      return NextResponse.json(
        { error: "Inscrição/equipe não encontrada no banco de dados." },
        { status: 404 }
      );
    }

    if (team.tournament_id !== tournamentId) {
      return NextResponse.json(
        { error: "A equipe informada não pertence ao torneio especificado." },
        { status: 400 }
      );
    }

    if (team.user_id && team.user_id !== authUser.id) {
      return NextResponse.json(
        { error: "403 Forbidden: Você não tem permissão para gerar cobrança para esta equipe." },
        { status: 403 }
      );
    }

    // 2.2 Buscar entry_fee oficial do torneio no banco de dados (ignorando totalAmount do cliente)
    const { data: tournament, error: tourErr } = await adminClient
      .from("tournaments")
      .select("id, name, entry_fee, status")
      .eq("id", tournamentId)
      .maybeSingle();

    if (tourErr || !tournament) {
      return NextResponse.json(
        { error: "Torneio não encontrado." },
        { status: 404 }
      );
    }

    const officialFee = Number(tournament.entry_fee || 0);
    if (officialFee <= 0) {
      return NextResponse.json(
        { error: "Este campeonato possui inscrição gratuita e não requer pagamento Pix." },
        { status: 400 }
      );
    }

    const amount = Math.round(officialFee * 100) / 100;
    const payerEmail =
      email && typeof email === "string" && email.includes("@")
        ? email.trim()
        : authUser.email || "atleta@sportconnect.com.br";
    const paymentDescription = `Inscrição SportConnect - ${teamName || team.name || "Equipe"}`;

    // Verificação da chave de acesso do Mercado Pago
    if (!process.env.MERCADOPAGO_ACCESS_TOKEN) {
      console.warn(
        "Aviso: MERCADOPAGO_ACCESS_TOKEN não está definido nas variáveis de ambiente (.env.local)."
      );
      return NextResponse.json(
        {
          error:
            "Credenciais do Mercado Pago não configuradas. Adicione MERCADOPAGO_ACCESS_TOKEN no arquivo .env.local.",
        },
        { status: 500 }
      );
    }

    // 3. Chamada da API do Mercado Pago V2 para criação do Pix
    const paymentResponse = await payment.create({
      body: {
        transaction_amount: amount,
        description: paymentDescription,
        payment_method_id: "pix",
        payer: {
          email: payerEmail,
        },
        metadata: {
          team_id: teamId,
          tournament_id: tournamentId,
        },
      },
    });

    // 4. Extrair qr_code_base64 e qr_code (copia e cola)
    const transactionData =
      paymentResponse.point_of_interaction?.transaction_data;
    const qr_code_base64 = transactionData?.qr_code_base64 || "";
    const qr_code = transactionData?.qr_code || "";

    // 5. Capturar o ID da transação do Mercado Pago e atualizar na tabela teams (mp_payment_id) via adminClient
    const mpPaymentId = paymentResponse.id?.toString();

    try {
      const { error: updateError } = await adminClient
        .from("teams")
        .update({
          payment_status: "WAITING_PIX",
          status: "PENDING",
          mp_payment_id: mpPaymentId,
          amount_paid: amount,
        })
        .eq("id", teamId);

      if (
        updateError &&
        (updateError.code === "PGRST204" ||
          updateError.code === "42703" ||
          String(updateError.message).includes("amount_paid"))
      ) {
        await adminClient
          .from("teams")
          .update({
            payment_status: "WAITING_PIX",
            status: "PENDING",
            mp_payment_id: mpPaymentId,
          })
          .eq("id", teamId);
      } else if (updateError) {
        console.warn(
          "Aviso ao atualizar mp_payment_id e payment_status no Supabase:",
          updateError.message
        );
      }
    } catch (dbErr) {
      console.warn("Exceção ao persistir payment_status no Supabase:", dbErr);
    }

    // 6. Calcular a divisão de 10% da taxa SportConnect
    const platformFee = Math.round(amount * 0.1 * 100) / 100;
    const organizerAmount = Math.round((amount - platformFee) * 100) / 100;

    // 7. Retornar dados em formato JSON com status 200
    return NextResponse.json(
      {
        success: true,
        id: paymentResponse.id,
        paymentId: mpPaymentId,
        mp_payment_id: mpPaymentId,
        status: paymentResponse.status || "WAITING_PIX",
        qr_code_base64,
        qr_code,
        qr_code_copia_e_cola: qr_code,
        qr_code_image_url: qr_code_base64
          ? `data:image/png;base64,${qr_code_base64}`
          : "",
        split: {
          platformFee,
          organizerAmount,
          platformFeePercentage: 10,
        },
        point_of_interaction: paymentResponse.point_of_interaction,
      },
      { status: 200 }
    );
  } catch (error: any) {
    // 8. Bloco try/catch para capturar erros e devolver status 500
    console.error("Erro ao criar pagamento Pix no Mercado Pago:", error);

    const errorMessage =
      error?.message ||
      error?.cause?.description ||
      "O Mercado Pago recusou a criação do pagamento via Pix.";

    return NextResponse.json(
      {
        error: errorMessage,
        details: error?.cause || null,
      },
      { status: 500 }
    );
  }
}
