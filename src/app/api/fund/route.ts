import { NextRequest, NextResponse } from "next/server";
import { Nord } from '@layer-n/nord-ts'


export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const publicKey = searchParams.get("publicKey");
  const contractAddress = searchParams.get("contractAddress");


  const hexStringToUint8Array = (hexString: string) => {
    const bytes = [];
    for (let i = 0; i < hexString.length; i += 2) {
      bytes.push(parseInt(hexString.substr(i, 2), 16));
    }
    return new Uint8Array(bytes);
  };

  const txHash = await Nord.depositOnlyTx(
    process.env.SECRET_FAUCET_PRIVATE_ADDRESS!,
    hexStringToUint8Array(publicKey as string),
    Math.round(
      (Math.random() * 0.1 + 1) * Number(process.env.NEXT_PUBLIC_SECRET_FUNDING_AMOUNT)
    ),
    Number(process.env.NEXT_PUBLIC_SECRET_FUNDING_PRECISION),
    contractAddress as string
  );

  return NextResponse.json({
    txHash: txHash,
  });

}
