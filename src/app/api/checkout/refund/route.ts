import { NextResponse } from "next/server";
import { confirmCancellation } from "@/app/actions/registration";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { teamId, userAuthToken } = body;

    if (!teamId) {
      return NextResponse.json(
        { success: false, error: "teamId é obrigatório." },
        { status: 400 }
      );
    }

    const authHeader = request.headers.get("authorization");
    const headerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : undefined;

    const result = await confirmCancellation(teamId, userAuthToken || headerToken);

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error || "Falha ao confirmar cancelamento e estornar Pix.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: result.message || "Inscrição cancelada e Pix estornado com sucesso!",
        data: result.data,
        refund: result.refund,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Exceção na rota de estorno:", err);
    return NextResponse.json(
      {
        success: false,
        error: err?.message || "Erro interno ao processar estorno do Pix.",
      },
      { status: 500 }
    );
  }
}
