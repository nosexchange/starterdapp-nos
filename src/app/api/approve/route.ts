import { Nord } from "@layer-n/nord-ts";
import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { ERC20_ABI } from "@/app/abis/ERC20_ABI";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const address = searchParams.get("address");

    // before funding, check for allowance
    const tokenAddress = process.env.NEXT_PUBLIC_TOKEN_ADDRESS as string;
    const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as string;
	
    const provider = new ethers.JsonRpcProvider(
      process.env.SECRET_FAUCET_RPC as string
    );
    const wallet = new ethers.Wallet(
      process.env.SECRET_FAUCET_PRIVATE_ADDRESS as string,
      provider
    );

    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

    let checkAllowance = await contract.allowance(
      address as string,
      contractAddress as string
    );

    let formattedAllowance = checkAllowance.toString();

    if (formattedAllowance === "0") {
      const txHash = await Nord.approveTx(
        process.env.SECRET_FAUCET_PRIVATE_ADDRESS as string,
        tokenAddress,
        contractAddress as string
      );

      return NextResponse.json({
        message: "Setting allowance",
        txHash: txHash,
      });
    }

    return NextResponse.json({
      message: "Allowance is already set",
    });

  } catch (error) {
    return NextResponse.json({ message: "Internal server error", error });
  }
}
