import { NextRequest, NextResponse } from "next/server";
import { depositOnlyTx } from "@layer-n/nord-ts/dist/nord/Nord";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const publicKey = searchParams.get("publicKey");
  const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as string;

  const hexStringToUint8Array = (hexString: string) => {
    const bytes = [];
    for (let i = 0; i < hexString.length; i += 2) {
      bytes.push(parseInt(hexString.substr(i, 2), 16));
    }
    return new Uint8Array(bytes);
  };

  const txHash = await depositOnlyTx(
    process.env.SECRET_FAUCET_PRIVATE_ADDRESS!,
    hexStringToUint8Array(publicKey as string),
    Number(process.env.NEXT_PUBLIC_SECRET_FUNDING_AMOUNT),
    Number(process.env.NEXT_PUBLIC_SECRET_FUNDING_PRECISION),
    contractAddress as string
  );

  return NextResponse.json({
    txHash: txHash,
  });
}
