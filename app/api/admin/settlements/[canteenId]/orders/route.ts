import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  OrderForSettlement,
  calculateOrderSettlement,
  aggregateCanteenSettlement,
  formatSettlementDate,
  getISTDateBounds,
} from "@/lib/financial-utils";
import type { OrderDetailsAPIResponse, OrderSettlementRow } from "@/types/analytics";

/**
 * GET /api/admin/settlements/[canteenId]/orders
 * 
 * Returns per-order breakdown for a specific canteen on T-2 date.
 * Strictly enforces T-2 working day logic.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ canteenId: string }> }
) {
  try {
    const { canteenId } = await params;
    // Service-role client: this route is super-admin gated below, and the
    // `coupon:coupon_id(code)` embed reads canteen_coupons, which has RLS
    // disabled and so carries no grant for `anon` on RDS (42501).
    const supabase = supabaseAdmin;

    // Authenticate super admin
    const authToken = request.cookies.get("auth_token")?.value;
    const userType = request.cookies.get("user_type")?.value;

    if (!authToken || userType !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify session
    const { data: session, error: sessionError } = await supabase
      .from("auth_sessions")
      .select("*")
      .eq("token", authToken)
      .eq("user_type", userType)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        { error: "Invalid or expired session" },
        { status: 401 }
      );
    }

    // Parse query params (supports single date OR range)
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date");
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    // Determine selection (default to today IST if nothing provided)
    let selectedFrom: Date;
    let selectedTo: Date;

    if (fromParam && toParam) {
      selectedFrom = new Date(fromParam);
      selectedTo = new Date(toParam);
    } else if (dateParam) {
      selectedFrom = new Date(dateParam);
      selectedTo = new Date(dateParam);
    } else {
      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      selectedFrom = nowIST;
      selectedTo = nowIST;
    }

    // Straight Date Filter (IST Boundaries)
    const startBounds = getISTDateBounds(selectedFrom);
    const endBounds = getISTDateBounds(selectedTo);
    const queryStart = startBounds.startDate;
    const queryEnd = endBounds.endDate;
    const resolvedFrom = selectedFrom;
    const resolvedTo = selectedTo;
    
    // Debug logging
    console.log(`[Order Details API] Canteen: ${canteenId}`);
    console.log(`[Order Details API] Selection: ${selectedFrom.toISOString()} TO ${selectedTo.toISOString()}`);
    console.log(`[Order Details API] Resolved T-2: ${resolvedFrom.toISOString()} TO ${resolvedTo.toISOString()}`);
    console.log(`[Order Details API] DB Query: >= ${queryStart.toISOString()} AND <= ${queryEnd.toISOString()}`);

    // Get canteen name
    const { data: canteen, error: canteenError } = await supabase
      .from("canteens")
      .select("id, name")
      .eq("id", canteenId)
      .single();

    if (canteenError || !canteen) {
      return NextResponse.json(
        { error: "Kitchen not found" },
        { status: 404 }
      );
    }

    // Fetch orders for this canteen within resolved T-2 range
    // Using queryStart/queryEnd which are properly adjusted for IST day boundaries
    const { data: ordersData, error: ordersError } = await supabase
      .from("orders")
      .select(`
        id,
        user_id,
        canteen_id,
        total_amount,
        canteen_amount,
        delivery_fee,
        packaging_fee,
        delivery_partner_amount,
        packaging_amount,
        gst_amount_total,
        gst_amount_canteen,
        is_gst_enabled,
        created_at,
        from_pos,
        is_settled,
        coupon:coupon_id(code),
        charges_data:charges(charge_amount, charge_reason, applied)
      `)
      .eq("canteen_id", canteenId)
      .gte("created_at", queryStart.toISOString())
      .lte("created_at", queryEnd.toISOString())
      .order("created_at", { ascending: true });

    if (ordersError) throw ordersError;

    // Transform to OrderForSettlement type
    const orders: OrderForSettlement[] = (ordersData || []).map((order: any) => {
      // Calculate total charges and concatenate reasons from the new charges table
      const chargesArray = order.charges_data || [];
      const totalCharges = chargesArray.reduce((sum: number, charge: any) => sum + (Number(charge.charge_amount) || 0), 0);
      const chargeReasons = chargesArray
        .map((charge: any) => charge.charge_reason)
        .filter(Boolean)
        .join("; ");

      return {
        id: order.id,
        user_id: order.user_id,
        canteen_id: order.canteen_id,
        total_amount: Number(order.total_amount) || 0,
        canteen_amount: Number(order.canteen_amount) || 0,
        delivery_fee: Number(order.delivery_fee) || 0,
        packaging_fee: Number(order.packaging_fee) || 0,
        delivery_partner_amount: Number(order.delivery_partner_amount) || 0,
        packaging_amount: Number(order.packaging_amount) || 0,
        gst_amount_total: Number(order.gst_amount_total) || 0,
        gst_amount_canteen: Number(order.gst_amount_canteen) || 0,
        is_gst_enabled: order.is_gst_enabled || false,
        created_at: order.created_at,
        is_settled: order.is_settled || false,
        from_pos: order.from_pos || false,
        coupon_code: order.coupon?.code,
        charges: totalCharges,
        charge_reason: chargeReasons || null,
        applied: order.is_settled // For order-specific charges, we can infer applied from order settlement status or the field itself
      };
    });

    // Calculate per-order breakdowns
    const orderRows: OrderSettlementRow[] = orders.map((order) => calculateOrderSettlement(order));

    // Fetch standalone charges for this canteen within resolved T-2 range
    const { data: standaloneChargesData } = await supabase
      .from("charges")
      .select("charge_amount, charge_reason, created_at, applied")
      .eq("canteen_id", canteenId)
      .is("order_id", null)
      .gte("created_at", queryStart.toISOString())
      .lte("created_at", queryEnd.toISOString());

    const standaloneCharges = (standaloneChargesData || []).map(c => ({
      amount: Number(c.charge_amount) || 0,
      reason: c.charge_reason || 'Miscellaneous Charge',
      createdAt: c.created_at,
      applied: !!c.applied
    }));

    const standaloneChargesTotal = standaloneCharges
      .filter(c => c.applied)
      .reduce((sum, c) => sum + c.amount, 0);
    
    const unappliedStandaloneChargesTotal = standaloneCharges
      .filter(c => !c.applied)
      .reduce((sum, c) => sum + c.amount, 0);

    // Calculate totals
    const totals = aggregateCanteenSettlement(orders, canteenId, canteen.name, 'pending');
    
    // Adjust totals with standalone charges
    totals.totalCharges = totals.totalCharges + standaloneChargesTotal + unappliedStandaloneChargesTotal;
    
    // Deduct applied standalone from paidAmount
    totals.paidAmount = Math.max(0, (totals.paidAmount || 0) - standaloneChargesTotal);
    
    // Deduct unapplied standalone from dueAmount
    totals.dueAmount = Math.max(0, (totals.dueAmount || 0) - unappliedStandaloneChargesTotal);
    
    // Final settlement amount is the sum of both
    totals.settlementAmount = (totals.paidAmount || 0) + (totals.dueAmount || 0);

    const response: OrderDetailsAPIResponse = {
      success: true,
      canteenId,
      canteenName: canteen.name,
      selectedDate: selectedFrom.toISOString(), // Legacy compatibility
      selectedDateFormatted: formatSettlementDate(selectedFrom),
      resolvedDate: resolvedFrom.toISOString(), // Legacy compatibility
      resolvedDateFormatted: selectedFrom.toDateString() === selectedTo.toDateString()
        ? formatSettlementDate(selectedFrom)
        : `${selectedFrom.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} - ${selectedTo.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`,
      
      // New Range Fields
      resolvedFrom: resolvedFrom.toISOString(),
      resolvedTo: resolvedTo.toISOString(),
      
      orders: orderRows,
      standaloneCharges,
      totals,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error: any) {
    console.error("Error in order details API:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch order details" },
      { status: 500 }
    );
  }
}
