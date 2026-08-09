"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  memo,
  useDeferredValue,
  useTransition,
  lazy,
  Suspense,
} from "react";
import { useCanteen } from "@/lib/canteen-context";
import { useAuth } from "@/lib/auth-context";
import { useOrderNotification } from "@/lib/hooks/use-order-notification";
import { useKeyboardNavigation } from "@/lib/hooks/use-keyboard-navigation";
import { KeyboardShortcutsHint } from "@/components/keyboard-shortcuts-hint";
import { useMenuItems, useStudents } from "@/hooks/use-order-builder-cache";
import { useOrdersData } from "@/hooks/use-orders-data";
import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Save, Clock, Search, Plus, Trash2, Edit2, Package, Bike, UtensilsCrossed, AlertCircle, ShoppingCart, ShoppingBag, Info, RotateCcw, Volume2, VolumeX, CheckSquare, Square, Check, ChefHat, Printer, Ban, Calendar, Minus, BookOpen, X } from 'lucide-react';
import {
  printReceipt as printReceiptPWA,
  type ReceiptData,
  isBluetoothEnabledAndConnected,
} from "@/lib/printer/pwa-printer";
import { printQueue } from "@/lib/printer/print-queue";
import { printKOT, type KOTData } from "@/lib/printer/kot-printer";
import { printHTML } from "@/lib/printer/html-print";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  MenuItemButton, 
  CartItem, 
  OrdersSkeleton, 
  MenuGridSkeleton, 
  EmptyOrdersState, 
  EmptyMenuState 
} from "./order-builder/components";
import { ScheduleTimer } from "./order-builder/schedule-timer";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface MenuItem {
  id: string;
  name: string;
  price: number;
}

interface OrderItem {
  menuItemId: string;
  name: string;
  canteen_price: number;
  quantity: number;
}

interface OrderWithItems {
  id: string;
  order_number: string;
  serial_number?: number;
  status:
    | "not_started"
    | "started"
    | "cooking"
    | "ready"
    | "completed"
    | "cancelled";
  payment_status?: "paid" | "pending";
  order_type?: "dine-in" | "takeaway" | "delivery";
  total_amount?: number;
  canteen_amount: number;
  packaging_fee?: number;
  packaging_amount?: number;
  delivery_fee?: number;
  delivery_partner_amount?: number;
  is_gst_enabled?: boolean;
  created_at: string;
  user_id?: string | null;
  address_id?: string | null;
  users?: {
    id: string;
    phone: string;
    name?: string;
    roll_number?: string;
  } | null;
  user_addresses?: {
    id: string;
    address: string;
    label?: string;
    phone?: string;
  } | null;
  order_items?: Array<{
    menu_item_id: string;
    quantity: number;
    price: number;
    canteen_price: number;
    menu_items?: { name: string; description?: string | null };
  }>;
  note?: string | null;
  order_mode?: string;
  scheduled_date?: string;
  scheduled_category_id?: string | null;
  schedule_id?: string | null;
}

interface OrderBuilderProps {
  onOrderCreated?: () => void;
}

// ============================================================================
// SUB-COMPONENTS - Moved to folder for performance
// ============================================================================

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function OrderBuilder({ onOrderCreated }: OrderBuilderProps) {
  const { user, isKitchen } = useAuth();
  const {
    selectedCanteen,
    selectedCanteenId,
    loading: canteenLoading,
  } = useCanteen();

  // Use caching hooks for menu, students, and orders
  const { menuItems, loading: menuLoading } = useMenuItems(
    selectedCanteenId ?? undefined,
  );
  const { students, loading: loadingStudents } = useStudents(
    selectedCanteenId ?? undefined,
  );
  const {
    orders: currentOrders,
    loading: ordersLoading,
    refreshOrders,
    lastUpdated,
    schedules,
  } = useOrdersData(selectedCanteenId ?? undefined);

  // Scheduling States
  const [viewTab, setViewTab] = useState<'instant' | 'scheduled'>('instant');
  
  // 🚀 For kitchens, we only show scheduled orders for now
  useEffect(() => {
    if (isKitchen) {
      setViewTab('scheduled');
    }
  }, [isKitchen]);

  const [selectedScheduleId, setSelectedScheduleId] = useState<string>('all');
  
  const getPresetDateStr = useCallback((offsetDays: number = 0) => {
    const d = new Date();
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    const ist = new Date(utc + (330 * 60000));
    ist.setDate(ist.getDate() + offsetDays);
    return ist.toISOString().split('T')[0];
  }, []);

  const [filterDate, setFilterDate] = useState<string>(getPresetDateStr(0));

  const todayStr = useMemo(() => getPresetDateStr(0), [getPresetDateStr]);
  const tomorrowStr = useMemo(() => getPresetDateStr(1), [getPresetDateStr]);
  const yesterdayStr = useMemo(() => getPresetDateStr(-1), [getPresetDateStr]);

  const currentDatePreset = useMemo(() => {
    if (filterDate === todayStr) return 'today';
    if (filterDate === tomorrowStr) return 'tomorrow';
    if (filterDate === yesterdayStr) return 'yesterday';
    return 'custom';
  }, [filterDate, todayStr, tomorrowStr, yesterdayStr]);

  const handleDatePresetChange = useCallback((preset: string) => {
    if (preset === 'today') setFilterDate(todayStr);
    else if (preset === 'tomorrow') setFilterDate(tomorrowStr);
    else if (preset === 'yesterday') setFilterDate(yesterdayStr);
  }, [todayStr, tomorrowStr, yesterdayStr]);

  // Batch actions
  const [showPrepSummary, setShowPrepSummary] = useState(false);

  const activeSchedules = useMemo(() => {
    return schedules.filter(s => s.is_active);
  }, [schedules]);

  const displayedOrders = useMemo(() => {
    if (!isKitchen) {
      return currentOrders.filter(o => o.order_mode !== 'scheduled');
    }
    if (viewTab === 'instant') {
      return currentOrders.filter(o => o.order_mode !== 'scheduled');
    } else {
      return currentOrders.filter(o => {
        if (o.order_mode !== 'scheduled') return false;
        if (o.scheduled_date) {
            if (o.scheduled_date !== filterDate) return false;
            // CHECKING BOTH schedule_id and scheduled_category_id for robust filtering
            if (selectedScheduleId !== 'all') {
              const orderSchedId = o.schedule_id || o.scheduled_category_id;
              if (orderSchedId !== selectedScheduleId) return false;
            }
            return o.status !== 'completed';
        }
        return false;
      });
    }
  }, [currentOrders, isKitchen, viewTab, filterDate, selectedScheduleId]);


  // React 18 Concurrent Features for better UX
  const [isPending, startTransition] = useTransition();

  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [nextOrderNumber, setNextOrderNumber] = useState("1");
  const [searchTerm, setSearchTerm] = useState("");

  // Deferred search - allows typing to remain responsive while filtering happens in background
  const deferredSearchTerm = useDeferredValue(searchTerm);

  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editingItems, setEditingItems] = useState<any[]>([]);
  const [editingOrderNumber, setEditingOrderNumber] = useState<string | null>(
    null,
  );
  const [studentSearch, setStudentSearch] = useState("");

  // Deferred student search for large student lists
  const deferredStudentSearch = useDeferredValue(studentSearch);

  const [khataDialogOpen, setKhataDialogOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<string>("");
  const [selectedOrder, setSelectedOrder] = useState<OrderWithItems | null>(
    null,
  );
  const [addingToKhata, setAddingToKhata] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [optimisticUpdates, setOptimisticUpdates] = useState<Set<string>>(
    new Set(),
  );

  const handleBatchUpdate = useCallback(async (newStatus: string, specificIds: string[]) => {
    if (specificIds.length === 0) return;

    setUpdateLoading(true);
    // Mark all as updating optimistically in one go
    setOptimisticUpdates(prev => {
      const next = new Set(prev);
      specificIds.forEach(id => next.add(id));
      return next;
    });

    try {
      await Promise.all(specificIds.map(async (id) => {
        const resp = await fetch(`/api/orders/update-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: id, newStatus }),
        });
        
        if (!resp.ok) {
          console.error(`Failed to update order ${id}`);
        }
      }));
      
      // Small delay for animation feel
      await new Promise(resolve => setTimeout(resolve, 300));
      await refreshOrders();
    } catch (err) {
      console.error('Batch update failed', err);
    } finally {
      setOptimisticUpdates(prev => {
        const next = new Set(prev);
        specificIds.forEach(id => next.delete(id));
        return next;
      });
      setUpdateLoading(false);
    }
  }, [refreshOrders]);

  const handleStartCookingAll = useCallback(() => {
    const pendingOrders = displayedOrders.filter(o => o.status === 'not_started' || o.status === 'started');
    if (pendingOrders.length > 0) {
      handleBatchUpdate('cooking', pendingOrders.map(o => o.id));
    }
  }, [displayedOrders, handleBatchUpdate]);

  const handleCompleteAll = useCallback(() => {
    const cookingOrders = displayedOrders.filter(o => o.status === 'cooking' || o.status === 'ready');
    if (cookingOrders.length > 0) {
      handleBatchUpdate('completed', cookingOrders.map(o => o.id));
    }
  }, [displayedOrders, handleBatchUpdate]);

  const prepSummaryItems = useMemo(() => {
    if (!showPrepSummary) return [];
    const summary = new Map<string, { name: string; quantity: number }>();
    displayedOrders.forEach((order: OrderWithItems) => {
      (order.order_items || []).forEach((item) => {
        const menuItemId = item.menu_item_id;
        const current = summary.get(menuItemId) || {
          name: item.menu_items?.name || "Unknown",
          quantity: 0,
        };
        current.quantity += item.quantity;
        summary.set(menuItemId, current);
      });
    });
    return Array.from(summary.values()).sort((a, b) => b.quantity - a.quantity);
  }, [displayedOrders, showPrepSummary]);

  // Note Modal State
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [selectedNoteOrder, setSelectedNoteOrder] =
    useState<OrderWithItems | null>(null);
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [editNoteText, setEditNoteText] = useState("");

  useEffect(() => {
    if (selectedNoteOrder) {
      setEditNoteText(selectedNoteOrder.note || "");
      setIsEditingNote(false); // Reset view mode
    }
  }, [selectedNoteOrder]);
  const [paymentStatus, setPaymentStatus] = useState<"paid" | "pending">(
    "pending",
  );
  const [orderType, setOrderType] = useState<
    "dine-in" | "takeaway" | "delivery"
  >("dine-in");
  const [orderNote, setOrderNote] = useState("");
  const printRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const noteInputRef = useRef<HTMLInputElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Info Dialog (Customer Details)
  const [infoDialogOpen, setInfoDialogOpen] = useState(false);
  const [selectedInfoOrder, setSelectedInfoOrder] = useState<OrderWithItems | null>(null);

  // Order notification sound hook
  const { isSoundEnabled, checkForNewOrders, toggleSound } =
    useOrderNotification({
      canteenId: selectedCanteen?.id || null,
      enabled: true,
      volume: 0.7,
    });

  // Filter menu items based on deferred search - allows typing to stay smooth
  const filteredItems = useMemo(() => {
    return menuItems.filter((item) =>
      item.name.toLowerCase().includes(deferredSearchTerm.toLowerCase()),
    );
  }, [menuItems, deferredSearchTerm]);

  // Keyboard navigation callbacks
  const handleAddItemByIndex = useCallback(
    (index: number) => {
      if (filteredItems[index]) {
        addItem(filteredItems[index]);
      }
    },
    [filteredItems],
  );

  const handleUpdateQuantityByIndex = useCallback(
    (index: number, delta: number) => {
      if (orderItems[index]) {
        updateQuantity(orderItems[index].menuItemId, delta);
      }
    },
    [orderItems],
  );

  const handleRemoveItemByIndex = useCallback(
    (index: number) => {
      if (orderItems[index]) {
        removeItem(orderItems[index].menuItemId);
      }
    },
    [orderItems],
  );

  const handleSetQuantityByIndex = useCallback(
    (index: number, quantity: number) => {
      if (orderItems[index]) {
        setOrderItems((prevItems) =>
          prevItems.map((item, i) =>
            i === index ? { ...item, quantity } : item,
          ),
        );
      }
    },
    [orderItems],
  );

  const handleTogglePayment = useCallback(() => {
    setPaymentStatus((prev) => (prev === "paid" ? "pending" : "paid"));
  }, []);

  const handleFocusSearch = useCallback(() => {
    setSearchTerm("");
    searchInputRef.current?.focus();
  }, []);

  const handleFocusNote = useCallback(() => {
    noteInputRef.current?.focus();
  }, []);

  const handleUpdateOrderStatusByIndex = useCallback(
    (index: number) => {
      const order = displayedOrders[index];
      if (!order) return;

      const nextStatus =
        order.status === "not_started"
          ? "started"
          : order.status === "started" ||
              order.status === "cooking" ||
              order.status === "ready"
            ? "completed"
            : order.status;

      if (nextStatus !== order.status) {
        updateOrderStatus(order.id, nextStatus as any);
      }
    },
    [displayedOrders], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handlePrintBillByIndex = useCallback(
    (index: number) => {
      const order = displayedOrders[index];
      if (order) {
        printOrder(order);
      }
    },
    [displayedOrders], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handlePrintKOTByIndex = useCallback(
    (index: number) => {
      const order = displayedOrders[index];
      if (order) {
        printKOTForOrder(order, true);
      }
    },
    [displayedOrders], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handleToggleOrderPaymentByIndex = useCallback(
    (index: number) => {
      const order = displayedOrders[index];
      if (order) {
        updatePaymentStatus(
          order.id,
          order.payment_status === "paid" ? "pending" : "paid",
        );
      }
    },
    [displayedOrders], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Check for new orders when orders update
  useEffect(() => {
    if (currentOrders.length > 0) {
      checkForNewOrders(currentOrders);
    }
  }, [currentOrders, checkForNewOrders]);

  const printOrder = useCallback(
    async (order: OrderWithItems) => {
      const itemsToPrint = order.order_items || [];

      // Use stored total_amount from database, fallback to canteen_amount
      const storedTotal = order.total_amount || order.canteen_amount;

      // Calculate items subtotal from stored prices
      const itemsSubtotal = itemsToPrint.reduce(
        (sum: number, it: any) => sum + it.price * it.quantity,
        0,
      );

      // Use stored packaging fee from order
      const packagingFee = order.packaging_fee || 0;

      // Get delivery fee from order (only for delivery orders)
      const deliveryFee =
        order.order_type === "delivery" && order.delivery_fee
          ? order.delivery_fee
          : 0;

      // Calculate GST as 5% of subtotal
      const gstAmount = order.is_gst_enabled ? itemsSubtotal * 0.05 : 0;

      // Use PWA printer with Bluetooth fallback
      await printReceiptPWA({
        canteenName: selectedCanteen?.name,
        address: selectedCanteen?.address || undefined,
        phone: selectedCanteen?.phone || undefined,
        orderNumber: order.order_number,
        serialNumber: order.serial_number,
        createdAt: order.created_at,
        items: itemsToPrint.map((it: any) => ({
          name: `${it.menu_items?.name || "Unknown"}`,
          quantity: it.quantity,
          price: it.price,
        })),
        subtotal: itemsSubtotal,
        gst: gstAmount > 0 ? gstAmount : undefined,
        packagingFee: packagingFee > 0 ? packagingFee : undefined,
        deliveryFee: deliveryFee > 0 ? deliveryFee : undefined,
        total: itemsSubtotal + gstAmount + packagingFee + deliveryFee,
        customerName: order.users?.name,
        customerPhone: order.users?.phone,
        customerRoll: order.users?.roll_number,
        customerAddress: order.user_addresses?.address,
      });
    },
    [selectedCanteen],
  );

  // Print KOT (Kitchen Order Ticket) - for kitchen workers - Memoized
  const printKOTForOrder = useCallback(
    async (order: OrderWithItems, useThermal: boolean = true) => {
      const itemsToPrint = order.order_items || [];

      // Prepare KOT data without pricing
      const kotData: KOTData = {
        canteenName: selectedCanteen?.name,
        orderNumber: order.order_number,
        serialNumber: order.serial_number,
        createdAt: order.created_at,
        items: itemsToPrint.map((it: any) => ({
          name: it.menu_items?.name || it.menu_items || "Unknown",
          quantity: it.quantity,
          // notes: '' // Can be added if you track item-specific notes
        })),
        customerName: order.users?.name,
        customerPhone: order.users?.phone,
        customerRoll: order.users?.roll_number,
        customerAddress: order.user_addresses?.address,
        orderType: order.order_type,
        // tableNumber: order.table_number, // Add if you track table numbers
        // specialInstructions: order.special_instructions, // Add if you track special instructions
      };

      // Print KOT
      await printKOT(kotData, useThermal);
    },
    [selectedCanteen],
  );

  // Legacy function - now handled by useStudents hook
  const fetchStudents = useCallback(() => {
    // Note: fetchStudents function now handled by useStudents hook with caching
    console.log("fetchStudents called - now using cached useStudents hook");
  }, []);

  useEffect(() => {
    if (!selectedCanteenId) return;

    // Generate next serial number for today
    const generateSerialNumber = async () => {
      const resp = await fetch(
        `/api/orders/today-latest?canteenId=${selectedCanteenId}`,
        { credentials: "include" },
      );
      if (!resp.ok) return 1;

      const data = await resp.json();
      return data.serialNumber ? data.serialNumber + 1 : 1;
    };

    // Initial data fetch
    const fetchInitialData = async () => {
      try {
        const nextSerial = await generateSerialNumber();
        setNextOrderNumber(nextSerial.toString());
      } catch (err) {
        console.error("Error fetching initial data:", err);
      }
    };

    fetchInitialData();

    // Handle online/offline events
    const handleOnline = () => {
      console.log("Online detected: Refreshing data...");
      fetchInitialData();
      refreshOrders(); // Trigger refresh from hook
    };

    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [selectedCanteenId, refreshOrders]); // Use stable ID

  // Memoized callback for adding items
  const addItem = useCallback((item: MenuItem) => {
    setOrderItems((prev) => {
      const existing = prev.find((oi) => oi.menuItemId === item.id);
      if (existing) {
        return prev.map((oi) =>
          oi.menuItemId === item.id ? { ...oi, quantity: oi.quantity + 1 } : oi,
        );
      } else {
        return [
          ...prev,
          {
            menuItemId: item.id,
            name: item.name,
            canteen_price: item.price,
            quantity: 1,
          },
        ];
      }
    });
  }, []);

  // Memoized callback for updating quantity
  const updateQuantity = useCallback((menuItemId: string, delta: number) => {
    setOrderItems((prev) =>
      prev
        .map((oi) =>
          oi.menuItemId === menuItemId
            ? { ...oi, quantity: Math.max(1, oi.quantity + delta) }
            : oi,
        )
        .filter((oi) => oi.quantity > 0),
    );
  }, []);

  // Memoized callback for removing items
  const removeItem = useCallback((menuItemId: string) => {
    setOrderItems((prev) => prev.filter((oi) => oi.menuItemId !== menuItemId));
  }, []);

  // Memoized filtered menu items using DEFERRED search for responsive typing
  // useDeferredValue allows the search input to remain responsive even with large menu lists
  const filteredMenuItems = useMemo(() => {
    return menuItems.filter((item) =>
      item.name.toLowerCase().includes(deferredSearchTerm.toLowerCase()),
    );
  }, [menuItems, deferredSearchTerm]);

  // Show stale indicator when search is pending (deferred value hasn't caught up)
  const isSearchStale = searchTerm !== deferredSearchTerm;

  // Memoized total calculation
  const total = useMemo(
    () =>
      orderItems.reduce(
        (sum, item) => sum + item.canteen_price * item.quantity,
        0,
      ),
    [orderItems],
  );

  // Calculate packaging fee based on order type and canteen settings - memoized
  const calculatePackagingFee = useCallback(() => {
    if (orderType === "dine-in" || !selectedCanteen) return 0;

    const feeType = selectedCanteen.packaging_fee_type || "fixed";
    if (feeType === "per_item") {
      const totalItems = orderItems.reduce(
        (sum, item) => sum + item.quantity,
        0,
      );
      return totalItems * (selectedCanteen.packaging_fee_per_item || 0);
    } else {
      return selectedCanteen.total_packaging_fee || 0;
    }
  }, [orderType, selectedCanteen, orderItems]);

  // Calculate packaging fee for an existing order - memoized
  const calculateOrderPackagingFee = useCallback(
    (order: OrderWithItems) => {
      if (order.order_type === "dine-in" || !selectedCanteen) return 0;

      const feeType = selectedCanteen.packaging_fee_type || "fixed";
      if (feeType === "per_item") {
        const totalItems = (order.order_items || []).reduce(
          (sum, item) => sum + item.quantity,
          0,
        );
        return totalItems * (selectedCanteen.packaging_fee_per_item || 0);
      } else {
        return selectedCanteen.total_packaging_fee || 0;
      }
    },
    [selectedCanteen],
  );

  // Calculate Delivery Fee - memoized
  const deliveryFee = useMemo(() => {
    if (
      orderType === "delivery" &&
      selectedCanteen &&
      (selectedCanteen as any).delivery_fee
    ) {
      return (selectedCanteen as any).delivery_fee;
    }
    return 0;
  }, [orderType, selectedCanteen]);

  // Calculate GST - memoized
  const gstAmount = useMemo(() => {
    if (selectedCanteen?.is_gst_enabled) {
      return total * 0.05;
    }
    return 0;
  }, [total, selectedCanteen]);

  // Memoized packaging fee for current order
  const packagingFee = useMemo(
    () => calculatePackagingFee(),
    [calculatePackagingFee],
  );

  // Final Grand Total
  const grandTotal = useMemo(
    () => total + packagingFee + deliveryFee + gstAmount,
    [total, packagingFee, deliveryFee, gstAmount],
  );

  // Generate new random order number for next order - memoized
  // Previously used, now we use serialNumber

  const submitOrder = useCallback(async () => {
    if (orderItems.length === 0) {
      alert("Please add items to order");
      return;
    }

    if (!selectedCanteen) {
      alert("Please select a kitchen first");
      return;
    }

    setLoading(true);

    try {
      const resp = await fetch("/api/orders/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          orderItems: orderItems.map((item) => ({
            menuItemId: item.menuItemId,
            quantity: item.quantity,
          })),
          canteenId: selectedCanteen.id,
          paymentStatus,
          orderType,
          orderNote,
          clientPackagingFee: packagingFee, // We pass this but the server should actually calculate it
        }),
      });

      if (!resp.ok) {
        const errorData = await resp.json();
        throw new Error(errorData.error || "Failed to create order");
      }

      const orderData = await resp.json();
      const generatedOrderNumber = orderData.orderNumber;
      const serialNumber = orderData.serialNumber;
      const totalAmt = orderData.items.reduce(
        (sum: number, item: any) => sum + item.price * item.quantity,
        0,
      );
      const gstAmount = orderData.gstAmount || 0;
      const finalTotal = orderData.totalAmount;
      const resolvedDeliveryFee = orderData.deliveryFee || 0;
      const resolvedPackagingFee = orderData.packagingFee || 0;
      const orderId = orderData.orderId;

      // Trigger push notifications via webhook (non-blocking)
      // This sends notifications to the canteen owner's subscribed devices
      fetch("/api/webhooks/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: orderId,
          order_number: generatedOrderNumber,
          total_amount: finalTotal,
          order_type: orderType,
          canteen_id: selectedCanteen.id,
          created_at: new Date().toISOString(),
        }),
      })
        .then(async (res) => {
          if (res.ok) {
            console.log("✅ Push notification sent successfully");
          } else {
            const errorText = await res.text();
            console.error("⚠️ Push notification failed:", errorText);
          }
        })
        .catch((err) => {
          // Don't fail the order creation if notification fails
          console.error("⚠️ Failed to send push notification:", err);
        });

      // Prepare receipt data for printing
      const itemsToPrint = orderItems.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        price: item.canteen_price,
      }));

      const receiptData: ReceiptData = {
        canteenName: selectedCanteen?.name,
        address: selectedCanteen?.address || undefined,
        phone: selectedCanteen?.phone || undefined,
        orderNumber: generatedOrderNumber,
        serialNumber: serialNumber,
        createdAt: new Date().toISOString(),
        items: itemsToPrint,
        subtotal: totalAmt,
        gst: gstAmount > 0 ? gstAmount : undefined,
        packagingFee:
          resolvedPackagingFee > 0 ? resolvedPackagingFee : undefined,
        deliveryFee: resolvedDeliveryFee > 0 ? resolvedDeliveryFee : undefined,
        total: finalTotal,
        orderType: orderType,
        paymentMethod: paymentStatus,
      };

      console.log("hi IAM DEBUGGING", receiptData);

      // Queue print job if Bluetooth is connected
      const bluetoothConnected = await isBluetoothEnabledAndConnected();
      if (bluetoothConnected) {
        console.log("Queuing Print Job (Bluetooth connected):", receiptData);
        await printQueue.addJob(receiptData);
      } else {
        console.log("ℹ️ Bluetooth not connected - skipping print queue");
      }

      // Refresh orders list
      await refreshOrders();

      // Cleanup form
      const nextSerial = serialNumber + 1;
      setNextOrderNumber(nextSerial.toString());
      setOrderItems([]);
      setPaymentStatus("pending");
      setOrderType("dine-in");
      setOrderNote("");
      onOrderCreated?.();
    } catch (err) {
      console.error("Order Submission Error:", err);
      alert(
        "Error creating order. Please try again. Error: " +
          (err instanceof Error ? err.message : "Unknown"),
      );
    } finally {
      setLoading(false);
    }
  }, [
    orderItems,
    selectedCanteen,
    paymentStatus,
    orderType,
    grandTotal,
    total,
    packagingFee,
    orderNote,
    onOrderCreated,
    refreshOrders,
  ]);

  // Simple print for initial order creation - only order number
  const printOrderNumberOnly = (orderNumber: number) => {
    const billContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Order #${orderNumber}</title>
        <style>
        /* Two explicit lengths, never a length paired with 'auto': that pairing is
           invalid per the CSS 'size' grammar, so the browser drops the whole
           declaration and falls back to the driver's default paper (US Letter),
           which a 58mm thermal driver prints as just the truncated top fragment.
           297mm is a roll-length ceiling; the margin must stay 0 so the 58mm body
           cannot overflow the page box. */
        @page {
          size: 58mm 297mm;
          margin: 0;
        }
        body { 
          font-family: 'Courier New', monospace; 
          width: 58mm;
          max-width: 58mm;
          margin: 0 auto;
          padding: 8px;
          background: white;
          font-weight: 900;
        }
        .order-number-display {
          text-align: center;
          font-size: 72px;
          font-weight: 900;
          margin: 0;
          padding: 0;
          line-height: 1;
        }
        .credits {
          text-align: center;
          font-size: 10px;
          font-weight: 900;
          margin-top: 5px;
          padding-top: 5px;
          border-top: 1px dashed #000;
        }
        </style>
      </head>
      <body>
        <div class="order-number-display">#${orderNumber}</div>
        <p class="credits">Made with ❤️ by Shahid Mollick & Sohail Belim (batch of 27)</p>
      </body>
      </html>
    `;

    // See printBillSilently: printHTML() owns the iframe lifecycle so the frame
    // outlives the job instead of being torn down on a timer.
    void printHTML(billContent);
  };

  // Detailed print function for order manager (kept for print button in right panel)
  const printBillSilently = (orderNumber: number) => {
    const billContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Order #${orderNumber}</title>
        <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        /* Two explicit lengths, never a length paired with 'auto': that pairing is
           invalid CSS, so the browser drops the declaration and falls back to the
           driver's default paper (US Letter), truncating the bill after the header. */
        @page { size: 58mm 297mm; margin: 0; }
        @media print {
          body { width: 58mm !important; }
          * { -webkit-print-color-adjust: exact !important; color-adjust: exact !important; print-color-adjust: exact !important; }
        }
        body { font-family: 'Courier New', Courier, monospace; width: 100%; max-width: 58mm; margin: 0; padding: 4px 8px; background: white; font-size: 14px; line-height: 1.5; font-weight: bold; color: #000; }
        .canteen-name { text-align: center; font-size: 22px; font-weight: bold; letter-spacing: 1px; margin: 2px 0 2px 0; text-transform: uppercase; }
        .address { text-align: center; font-size: 11px; font-weight: bold; margin: 2px 0; line-height: 1.3; }
        .phone { text-align: center; font-size: 12px; font-weight: bold; margin: 2px 0 4px 0; }
        .header { text-align: center; margin-bottom: 10px; border-bottom: 2px solid #000; padding-bottom: 8px; }
        .header p { margin: 3px 0; font-size: 13px; font-weight: bold; }
        .order-number { font-size: 20px; font-weight: bold; margin: 5px 0; }
        .items { margin: 10px 0; min-height: 50px; }
        .item { width: 100%; margin: 5px 0; font-size: 15px; line-height: 1.6; }
        .item-row { display: table; width: 100%; }
        .item-name { display: table-cell; width: 60%; word-wrap: break-word; font-weight: bold; vertical-align: top; }
        .item-qty { display: table-cell; width: 15%; text-align: center; font-weight: bold; vertical-align: top; }
        .item-price { display: table-cell; width: 25%; text-align: right; font-weight: bold; vertical-align: top; }
        .divider { border-top: 2px solid #000; margin: 8px 0; }
        .total-section { border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 8px 0; margin: 10px 0; }
        .total { width: 100%; margin: 5px 0; font-size: 18px; }
        .total-row { display: table; width: 100%; }
        .total-label { display: table-cell; font-size: 16px; font-weight: bold; }
        .total-amount { display: table-cell; text-align: right; font-size: 22px; font-weight: bold; }
        .footer { text-align: center; margin-top: 15px; padding-top: 10px; padding-bottom: 10px; border-top: 1px solid #000; page-break-inside: avoid; }
        .footer p { margin: 5px 0; font-size: 12px; font-weight: bold; }
        .footer .thank-you { font-size: 15px; font-weight: bold; margin-bottom: 8px; }
        .footer .credits { font-size: 13px; font-style: italic; margin-top: 8px; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="canteen-name">${selectedCanteen?.name?.toUpperCase() || "CANTEEN"}</div>
        ${selectedCanteen?.address ? `<div class="address">${selectedCanteen.address}</div>` : ""}
        ${selectedCanteen?.phone ? `<div class="phone">Ph: ${selectedCanteen.phone}</div>` : ""}
        <div class="header">
        <p class="order-number">Order #${orderNumber}</p>
        <p>${new Date().toLocaleString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })}</p>
        </div>
        <div class="items">
        ${orderItems
          .map(
            (item) => `
          <div class="item">
          <div class="item-row">
          <span class="item-name">${item.name}</span>
          <span class="item-qty">×${item.quantity}</span>
          <span class="item-price">₹${(item.canteen_price * item.quantity).toFixed(2)}</span>
          </div>
          </div>
        `,
          )
          .join("")}
        </div>
        <div class="total-section">
        <div class="total">
          <div class="total-row">
          <span class="total-label">TOTAL:</span>
          <span class="total-amount">₹${total.toFixed(2)}</span>
          </div>
        </div>
        </div>
        <div class="footer">
        <p class="thank-you">Thank You! Visit Again</p>
        <p class="credits">Made with ❤️ by Shahid & Sohail</p>
        </div>
      </body>
      </html>
    `;

    // Delegated to printHTML() rather than driven here: assigning iframe.onload
    // after iframeDoc.close() can miss the load event entirely, and removing the
    // frame on a fixed 3s timer tears the source away while the browser is still
    // generating the job - the printer then gets a partial stream and stalls
    // waiting for the rest, which wedges the queue until it is power-cycled.
    void printHTML(billContent);
  };

  // ============================================================================
  // ORDER MANAGEMENT FUNCTIONS - All memoized with useCallback + Optimistic Updates
  // ============================================================================

  /**
   * Update order status
   */
  const updateOrderStatus = useCallback(
    async (
      orderId: string,
      newStatus:
        | "not_started"
        | "started"
        | "cooking"
        | "ready"
        | "completed"
        | "cancelled",
    ) => {
      // Mark as updating
      setOptimisticUpdates((prev) => new Set(prev).add(orderId));

      try {
        const resp = await fetch("/api/orders/update-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ orderId, newStatus }),
        });

        if (!resp.ok) {
          const errorData = await resp.json();
          throw new Error(errorData.error || "Failed to update order status");
        }

        // Success - wait briefly for animation
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Remove from optimistic set
        setOptimisticUpdates((prev) => {
          const next = new Set(prev);
          next.delete(orderId);
          return next;
        });

        // Trigger push notification to user (non-blocking)
        fetch("/api/orders/notify-status-change", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, newStatus }),
        }).catch((err) => {
          console.error("Failed to send push notification:", err);
        });

        // Refresh orders from hook
        await refreshOrders();
      } catch (err) {
        console.error("Error updating order status:", err);
        setOptimisticUpdates((prev) => {
          const next = new Set(prev);
          next.delete(orderId);
          return next;
        });
        alert(
          `Failed to update order status. ${err instanceof Error ? err.message : "Please try again."}`,
        );
      }
    },
    [refreshOrders],
  );

  /**
   * Update order note
   */
  const updateOrderNote = useCallback(
    async (orderId: string, note: string) => {
      setUpdateLoading(true);
      try {
        const resp = await fetch("/api/orders/update-note", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ orderId, note }),
        });

        if (!resp.ok) {
          const errorData = await resp.json();
          throw new Error(errorData.error || "Failed to update order note");
        }

        // alert is already used in this file for errors
        setNoteDialogOpen(false);
        await refreshOrders();
      } catch (err) {
        console.error("Error updating order note:", err);
        alert(
          `Failed to update order note. ${err instanceof Error ? err.message : "Please try again."}`,
        );
      } finally {
        setUpdateLoading(false);
      }
    },
    [refreshOrders],
  );

  /**
   * Update payment status
   */
  const updatePaymentStatus = useCallback(
    async (orderId: string, newPaymentStatus: "paid" | "pending") => {
      try {
        const resp = await fetch("/api/orders/update-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ orderId, paymentStatus: newPaymentStatus }),
        });

        if (!resp.ok) {
          const errorData = await resp.json();
          throw new Error(errorData.error || "Failed to update payment status");
        }

        // Refresh orders from hook
        await refreshOrders();
      } catch (err) {
        console.error("Error updating payment status:", err);
        alert(
          `Failed to update payment status: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    },
    [refreshOrders],
  );

  /**
   * Delete order
   */
  const deleteOrder = useCallback(
    async (orderId: string, skipConfirm: boolean = false) => {
      if (
        !skipConfirm &&
        !confirm("Are you sure you want to delete this order?")
      )
        return;

      try {
        const resp = await fetch("/api/orders/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ orderId }),
        });

        if (!resp.ok) {
          const errorData = await resp.json();
          throw new Error(errorData.error || "Failed to delete order");
        }

        // Refresh orders from hook
        await refreshOrders();
      } catch (err) {
        console.error("Error deleting order:", err);
        alert(
          `Failed to delete order: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    },
    [refreshOrders],
  );

  const startEditingOrder = useCallback((order: OrderWithItems) => {
    setEditingOrderId(order.id);
    setEditingOrderNumber(
      (order.serial_number || order.order_number).toString(),
    );
    if (order.order_items) {
      const items: OrderItem[] = order.order_items.map((item) => ({
        menuItemId: item.menu_item_id,
        name: item.menu_items?.name || "Unknown",
        canteen_price: item.canteen_price,
        quantity: item.quantity,
      }));
      setOrderItems(items);
      setEditingItems([...order.order_items]);
    }
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingOrderId(null);
    setEditingOrderNumber(null);
    setEditingItems([]);
    setOrderItems([]);
  }, []);

  const addOrderToKhata = useCallback(async () => {
    if (!selectedStudent || !selectedOrder || !selectedCanteen) return;

    setAddingToKhata(true);
    try {
      const itemsNote = (selectedOrder.order_items || [])
        .map(
          (item) => `${item.menu_items?.name || "Unknown"} x${item.quantity}`,
        )
        .join(", ");

      const orderAmount = Number(selectedOrder.canteen_amount);

      const resp = await fetch("/api/khata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          type: "add_entry",
          payload: {
            khata_id: selectedStudent,
            order_id: selectedOrder.id,
            amount: orderAmount,
            notes: `Order #${selectedOrder.serial_number} - ${itemsNote}`,
            entry_type: "purchase",
          },
        }),
      });

      if (!resp.ok) {
        const errorData = await resp.json();
        throw new Error(errorData.error || "Failed to add order to khata");
      }

      setKhataDialogOpen(false);
      setSelectedStudent("");
      setSelectedOrder(null);
      alert("Order added to khata successfully!");

      // Refresh orders since payment status might have changed
      refreshOrders();
    } catch (err) {
      console.error("Error adding to khata:", err);
      alert(
        `Failed to add order to khata: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setAddingToKhata(false);
    }
  }, [selectedStudent, selectedOrder, selectedCanteen, refreshOrders]);

  const updateEditingItemQuantity = useCallback(
    (menuItemId: string, delta: number) => {
      setEditingItems((items) =>
        items.map((item) =>
          item.menu_item_id === menuItemId
            ? { ...item, quantity: Math.max(1, item.quantity + delta) }
            : item,
        ),
      );
    },
    [],
  );

  const removeEditingItem = useCallback((menuItemId: string) => {
    setEditingItems((items) =>
      items.filter((item) => item.menu_item_id !== menuItemId),
    );
  }, []);

  const addItemToEdit = useCallback((menuItem: MenuItem) => {
    setEditingItems((prev) => {
      const existingItem = prev.find(
        (item) => item.menu_item_id === menuItem.id,
      );
      if (existingItem) {
        return prev.map((item) =>
          item.menu_item_id === menuItem.id
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      } else {
        return [
          ...prev,
          {
            menu_item_id: menuItem.id,
            quantity: 1,
            canteen_price: menuItem.price,
            menu_items: { name: menuItem.name },
          },
        ];
      }
    });
  }, []);

  const saveOrderEdit = useCallback(
    async (orderId: string) => {
      if (orderItems.length === 0) {
        alert("Order must have at least one item");
        return;
      }

      setUpdateLoading(true);
      try {
        const resp = await fetch("/api/orders/edit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            orderId,
            orderItems: orderItems.map((item) => ({
              menuItemId: item.menuItemId,
              quantity: item.quantity,
              canteen_price: item.canteen_price,
            })),
            canteenId: selectedCanteen?.id,
          }),
        });

        if (!resp.ok) {
          const errorData = await resp.json();
          throw new Error(errorData.error || "Failed to update order");
        }

        setEditingOrderId(null);
        setEditingOrderNumber(null);
        setEditingItems([]);
        setOrderItems([]);
      } catch (err) {
        console.error("Error saving order:", err);
        alert("Failed to save order changes");
      } finally {
        setUpdateLoading(false);
      }
    },
    [orderItems, selectedCanteen],
  );

  // Memoized status helpers
  const getStatusIcon = useCallback((status: string) => {
    switch (status) {
      case "not_started":
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case "started":
        return <ChefHat className="w-4 h-4 text-orange-500" />;
      case "cooking":
        return <ChefHat className="w-4 h-4 text-red-500" />;
      case "ready":
        return <Check className="w-4 h-4 text-green-500" />;
      case "completed":
        return <Check className="w-4 h-4 text-blue-500" />;
      default:
        return null;
    }
  }, []);

  const getStatusLabel = useCallback((status: string) => {
    switch (status) {
      case "not_started":
        return "Waiting";
      case "started":
        return "Started";
      case "cooking":
        return "Cooking";
      case "ready":
        return "Ready";
      default:
        return status;
    }
  }, []);

  // Keyboard navigation hook - placed here after all function definitions
  const handleSubtractItemByIndex = useCallback(
    (index: number) => {
      if (filteredItems[index]) {
        const item = filteredItems[index];
        const existing = orderItems.find((oi) => oi.menuItemId === item.id);
        if (existing) {
          if (existing.quantity === 1) removeItem(item.id);
          else updateQuantity(item.id, -1);
        }
      }
    },
    [filteredItems, orderItems],
  );

  const { focusSection, menuIndex, cartIndex, orderIndex } =
    useKeyboardNavigation({
      menuItemsCount: filteredItems.length,
      cartItemsCount: orderItems.length,
      ordersCount: displayedOrders.length,
      onAddItem: handleAddItemByIndex,
      onSubtractItem: handleSubtractItemByIndex,
      onUpdateQuantity: handleUpdateQuantityByIndex,
      onRemoveItem: handleRemoveItemByIndex,
      onSetQuantity: handleSetQuantityByIndex,
      onSubmitOrder: submitOrder,
      onResetOrder: () => setOrderItems([]),
      onSetOrderType: setOrderType,
      onTogglePayment: handleTogglePayment,
      onFocusSearch: handleFocusSearch,
      onFocusNote: handleFocusNote,
      onUpdateOrderStatus: handleUpdateOrderStatusByIndex,
      onPrintBill: handlePrintBillByIndex,
      onPrintKOT: handlePrintKOTByIndex,
      onToggleOrderPayment: handleToggleOrderPaymentByIndex,
      enabled: !editingOrderId, // Disable during editing mode
    });

  return (
    <>
      {/* MOBILE & TABLET VIEW - Active Orders + Bottom Drawer (< 1280px) */}
      <div className="xl:hidden flex flex-col h-[calc(100vh-140px)]">
        {/* Mobile & Tablet Header */}
        <div className="bg-slate-50 dark:bg-[#0a0f1e] border-b border-slate-200 dark:border-slate-800 px-3 md:px-6 py-3 md:py-4 shrink-0 flex justify-between items-center">
          <div>
            <h2 className="text-xl md:text-2xl font-bold text-red-600 dark:text-red-500">
              Orders Management
            </h2>
            <p className="text-xs md:text-sm text-slate-600 dark:text-slate-400 mt-1">
              Manage and track current orders
            </p>
          </div>
          {isKitchen && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPrepSummary(true)}
              className="h-9 text-xs font-bold border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30"
            >
              Prep Summary
            </Button>
          )}
        </div>

        {/* Mobile Tabs for Kitchen Users */}
        {isKitchen && (
          <div className="bg-slate-50 dark:bg-[#0a0f1e] px-3 md:px-6 pb-2 shrink-0">
            <div className="flex gap-1 p-1 bg-slate-200 dark:bg-[#1e293b] rounded-lg w-full max-w-sm">
              {/* <button
                className={`flex-1 py-1.5 md:py-2 text-sm font-bold rounded-md transition-all ${viewTab === 'instant' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                onClick={() => setViewTab('instant')}
              >
                Instant Orders
              </button> */}
              <button
                className={`flex-1 py-1.5 md:py-2 text-sm font-bold rounded-md transition-all ${viewTab === 'scheduled' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                onClick={() => setViewTab('scheduled')}
              >
                Scheduled Orders
              </button>
            </div>
            
            {viewTab === 'scheduled' && (
              <div className="flex flex-col gap-2 mt-3">
                {/* Date Filter */}
                <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                  <Select value={currentDatePreset} onValueChange={handleDatePresetChange}>
                    <SelectTrigger className="h-8 text-[11px] w-[110px] bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 font-bold shadow-sm shrink-0">
                      <SelectValue placeholder="Date" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="today">Today</SelectItem>
                      <SelectItem value="tomorrow">Tomorrow</SelectItem>
                      <SelectItem value="yesterday">Yesterday</SelectItem>
                      <SelectItem value="custom">Custom...</SelectItem>
                    </SelectContent>
                  </Select>
                  
                  {viewTab === 'scheduled' && (
                    <div className="flex gap-1.5 flex-wrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleStartCookingAll}
                        disabled={updateLoading || displayedOrders.filter(o => o.status === 'not_started' || o.status === 'started').length === 0}
                        className="h-8 px-2 text-[9px] font-black border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-900/30 whitespace-nowrap active:scale-95 transition-all"
                      >
                        Start Cooking All
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCompleteAll}
                        disabled={updateLoading || displayedOrders.filter(o => o.status === 'cooking' || o.status === 'ready').length === 0}
                        className="h-8 px-2 text-[9px] font-black border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-500 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 whitespace-nowrap active:scale-95 transition-all"
                      >
                        Complete All
                      </Button>
                    </div>
                  )}
                  {currentDatePreset === 'custom' && (
                    <input 
                      type="date"
                      value={filterDate}
                      onChange={(e) => setFilterDate(e.target.value)}
                      className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-1.5 h-8 text-[10px] w-[100px] text-slate-600 dark:text-slate-400 shadow-sm outline-none focus:ring-1 focus:ring-red-500"
                    />
                  )}
                </div>

                {/* Schedule Tabs */}
                {activeSchedules.length > 0 && (
                  <>
                    <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                      <button
                        onClick={() => setSelectedScheduleId('all')}
                        className={`px-3 py-1.5 text-xs font-bold rounded-full transition-colors whitespace-nowrap shrink-0 ${
                          selectedScheduleId === 'all'
                            ? 'bg-red-600 text-white shadow-sm'
                            : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                        }`}
                      >
                        All
                      </button>
                      {activeSchedules.map(schedule => (
                        <button
                          key={schedule.id}
                          onClick={() => setSelectedScheduleId(schedule.id)}
                          className={`px-3 py-1.5 text-xs font-bold rounded-full transition-colors whitespace-nowrap shrink-0 ${
                            selectedScheduleId === schedule.id
                              ? 'bg-red-600 text-white shadow-sm'
                              : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                          }`}
                        >
                          {schedule.name}
                        </button>
                      ))}
                    </div>

                    {/* Arrival Timer Banner */}
                    {selectedScheduleId !== 'all' && (
                      <div className="mt-2 mb-1">
                        {(() => {
                          const activeSchedule = activeSchedules.find(s => s.id === selectedScheduleId);
                          if (!activeSchedule) return null;
                          return (
                            <ScheduleTimer 
                              schedule={activeSchedule} 
                              targetDateStr={filterDate} 
                              variant="arrival" 
                              scheduleName={activeSchedule.name}
                            />
                          );
                        })()}
                      </div>
                    )}
                  </>
                )}

              </div>
            )}
          </div>
        )}

        {/* Active Orders Area - Scrollable */}
        <div className="flex-1 overflow-y-auto px-3 md:px-6 py-4 relative">
          {displayedOrders.length === 0 ? (
            <div className="text-center py-16 text-slate-400 dark:text-slate-500">
              <Clock className="w-16 h-16 mx-auto mb-4 opacity-40" />
              <p className="text-base font-medium">No active orders</p>
              <p className="text-xs mt-2 opacity-70">Start by creating a new order below</p>
            </div>
          ) : viewTab === 'scheduled' ? (
            /* ── SCHEDULED ORDERS: Clean Compact Table ── */
            <div className="pb-32">
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                      <th className="py-2.5 px-3">Order</th>
                      <th className="py-2.5 px-3">Items</th>
                      <th className="py-2.5 px-3 text-center">Print</th>
                      <th className="py-2.5 px-3 text-center">Info</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                    {displayedOrders.map((order) => {
                      const schedule = schedules.find(s => s.id === order.scheduled_category_id);
                      const isOptimisticallyUpdating = optimisticUpdates.has(order.id);

                      return (
                        <tr
                          key={order.id}
                          className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors relative ${
                            order.status === 'completed' ? 'opacity-50 grayscale' : ''
                          } ${isOptimisticallyUpdating ? 'opacity-50' : ''}`}
                        >
                          {/* Order # + Timer */}
                          <td className="py-2.5 px-3 align-top min-w-[4rem]">
                            <div className="flex flex-col gap-1">
                              <span className="font-black text-slate-900 dark:text-slate-100 text-sm">
                                #{order.serial_number}
                              </span>
                              {schedule && (
                                <ScheduleTimer schedule={schedule} targetDateStr={filterDate} />
                              )}
                            </div>
                          </td>
                          {/* Items List */}
                          <td className="py-2.5 px-3 align-top">
                            <ul className="space-y-0.5">
                              {(order.order_items || []).map((item: any, idx: number) => (
                                <li key={idx} className="flex items-start text-xs font-medium text-slate-700 dark:text-slate-300">
                                  <span className="font-bold text-slate-900 dark:text-slate-100 mr-1.5 shrink-0">{item.quantity}x</span>
                                  <span className="leading-tight">{item.menu_items?.name || "Unknown"}</span>
                                </li>
                              ))}
                            </ul>
                            {order.note && (
                              <div className="mt-1 inline-flex items-center gap-1 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded text-[10px] font-bold border border-amber-200 dark:border-amber-800/50">
                                <AlertCircle className="w-3 h-3" /> Note
                              </div>
                            )}
                          </td>
                          {/* Print KOT */}
                          <td className="py-2.5 px-3 align-middle text-center">
                            <Button
                              onClick={() => printKOTForOrder(order, true)}
                              disabled={updateLoading}
                              variant="outline"
                              className="h-7 w-7 p-0 shrink-0 mx-auto rounded-md border-orange-200 dark:border-orange-900 text-orange-600 dark:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/30"
                              title="Print KOT"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </Button>
                          </td>
                          {/* Info Button */}
                          <td className="py-2.5 px-3 align-middle text-center">
                            <Button
                              onClick={() => {
                                setSelectedInfoOrder(order);
                                setInfoDialogOpen(true);
                              }}
                              variant="ghost"
                              className="h-7 w-7 p-0 hover:bg-slate-100 dark:hover:bg-slate-700/50 mx-auto rounded-full"
                              title="Customer Info"
                            >
                              <Info className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                            </Button>
                          </td>
                          {/* Complete Action */}
                          <td className="py-2.5 px-3 align-middle text-right">
                            {order.status !== 'completed' && order.status !== 'cancelled' ? (
                              <Button
                                onClick={() => {
                                  const nextStatus = (order.status === 'not_started' || order.status === 'started') ? 'cooking' : 'completed';
                                  updateOrderStatus(order.id, nextStatus);
                                }}
                                disabled={updateLoading}
                                className={`h-8 text-white font-black text-[10px] shadow-lg active:scale-95 transition-all flex items-center gap-1.5 px-3 rounded-lg ${
                                  (order.status === 'not_started' || order.status === 'started') 
                                    ? "bg-amber-600 hover:bg-amber-700 shadow-amber-900/20" 
                                    : "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-900/20"
                                }`}
                                size="sm"
                              >
                                {(order.status === 'not_started' || order.status === 'started') ? (
                                  <>
                                    <ChefHat className="w-3.5 h-3.5" />
                                    <span>Cook</span>
                                  </>
                                ) : (
                                  <>
                                    <Check className="w-4 h-4" />
                                    <span>Done</span>
                                  </>
                                )}
                              </Button>
                            ) : (
                              <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{order.status}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* ── INSTANT ORDERS: Card Format (unchanged) ── */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 pb-32">
            {displayedOrders.map((order, idx) => {
                const isEditing = editingOrderId === order.id;
                const isExpanded = expandedOrderId === order.id;
                const isKeyboardSelected =
                  focusSection === "orders" && orderIndex === idx;
                const displayItems = isEditing
                  ? editingItems
                  : order.order_items || [];
                const total = isEditing
                  ? editingItems.reduce(
                      (sum, item) =>
                        sum +
                        (item.canteen_price || item.price) * item.quantity,
                      0,
                    )
                  : order.canteen_amount || order.total_amount;
                const isOptimisticallyUpdating = optimisticUpdates.has(
                  order.id,
                );

                return (
                  <div
                    key={order.id}
                    onClick={() =>
                      setExpandedOrderId(isExpanded ? null : order.id)
                    }
                    className={`rounded-xl border-2 transition-all shadow-sm active:shadow-md cursor-pointer ${
                      isKeyboardSelected
                        ? "ring-2 ring-red-600 ring-offset-2 dark:ring-offset-slate-900 transform scale-[1.02] z-10"
                        : ""
                    } ${
                      (order.status === "not_started" || order.status === "started")
                        ? "border-red-600 bg-slate-50 dark:bg-slate-900/20"
                        : (order.status === "cooking" || order.status === "ready")
                        ? "border-blue-600 bg-slate-50 dark:bg-slate-900/20"
                        : "border-slate-400 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-900/20"
                    }`}>
                    {isOptimisticallyUpdating && (
                      <div className="absolute inset-0 bg-white/60 dark:bg-slate-900/60 backdrop-blur-[1px] z-10 flex items-center justify-center">
                        <div className="flex items-center gap-2 bg-white dark:bg-slate-800 rounded-full px-4 py-2 shadow-lg">
                          <div className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                            Updating...
                          </span>
                        </div>
                      </div>
                    )}
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-3">
                          <div className="bg-[#1e293b] text-white dark:bg-white dark:text-slate-900 w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-sm border border-slate-700 dark:border-slate-200">
                            <span className="font-bold text-sm">
                              #{order.serial_number}
                            </span>
                          </div>
                          <div className="flex flex-col">
                            {order.user_id && order.users ? (
                              <>
                                <p className="font-bold text-sm text-slate-200 dark:text-slate-800 leading-tight">
                                  {order.users.name || "Unknown User"}
                                </p>
                                <p className="text-xs text-slate-400 dark:text-slate-500 font-medium">
                                  {order.users.phone}
                                </p>
                              </>
                            ) : (
                              <p className="font-bold text-sm text-slate-400 dark:text-slate-500">
                                Guest
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {order.order_type && (
                            <span
                              className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold text-white shadow-sm bg-[#247cff]`}>
                              {order.order_type === "dine-in" && (
                                <UtensilsCrossed className="w-3 h-3 mr-1" />
                              )}
                              {order.order_type === "takeaway" && (
                                <Package className="w-3 h-3 mr-1" />
                              )}
                              {order.order_type === "delivery" && (
                                <Bike className="w-3 h-3 mr-1" />
                              )}
                              {order.order_type === "dine-in" ? "Dine-in" : order.order_type.charAt(0).toUpperCase() + order.order_type.slice(1)}
                            </span>
                          )}

                          {!isEditing && !order.user_id && (
                            <div
                              className="flex items-center gap-1 ml-1"
                              onClick={(e) => e.stopPropagation()}>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setSelectedOrder(order);
                                  setKhataDialogOpen(true);
                                }}
                                disabled={updateLoading}
                                className="h-7 w-7 p-0 hover:bg-slate-700/50 dark:hover:bg-slate-200/50 text-slate-400 hover:text-white dark:text-slate-500 dark:hover:text-slate-900 transition-colors">
                                <Plus className="w-4 h-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  startEditingOrder(order);
                                  setDrawerOpen(true);
                                }}
                                disabled={updateLoading}
                                className="h-7 w-7 p-0 hover:bg-slate-700/50 dark:hover:bg-slate-200/50 text-slate-400 hover:text-white dark:text-slate-500 dark:hover:text-slate-900 transition-colors">
                                <Edit2 className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => deleteOrder(order.id)}
                                disabled={updateLoading}
                                className="h-7 w-7 p-0 hover:bg-red-900/40 dark:hover:bg-red-100 hover:text-red-500 dark:hover:text-red-600 text-slate-400 dark:text-slate-500 transition-colors">
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>

                      <div
                        className="overflow-hidden transition-all duration-300 ease-in-out"
                        style={{
                          maxHeight: isExpanded || isEditing ? "500px" : "0px",
                        }}>
                        <div className="space-y-1.5 mb-2 animate-in fade-in slide-in-from-top-2 duration-300">
                          {displayItems.map((item: any, idx: number) => (
                            <div
                              key={idx}
                              className="bg-white dark:bg-slate-900 rounded-lg p-2 shadow-sm">
                              <div className="flex justify-between items-start gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-xs text-slate-800 dark:text-slate-200 leading-tight">
                                    {item.menu_items?.name || "Unknown"}
                                  </p>
                                  {item.menu_items?.description && (
                                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 leading-snug">
                                      {item.menu_items.description}
                                    </p>
                                  )}
                                </div>
                                <span className="font-bold text-xs bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded shrink-0">
                                  ×{item.quantity}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Total */}
                      <div className="pt-2 border-t border-dashed border-slate-300 dark:border-slate-600">
                        {(() => {
                          const packagingFee =
                            order.packaging_amount || order.packaging_fee || 0;
                          const deliveryFee = order.delivery_fee || 0;
                          const itemsSubtotal = displayItems.reduce(
                            (sum: number, item: any) =>
                              sum + (item.canteen_price || 0) * item.quantity,
                            0,
                          );
                          const gstAmount = order.is_gst_enabled
                            ? itemsSubtotal * 0.05
                            : 0;

                          const hasBreakdown =
                            packagingFee > 0 ||
                            gstAmount > 0 ||
                            deliveryFee > 0;

                          return hasBreakdown &&
                            (order.order_type === "delivery" ||
                              order.order_type === "takeaway" ||
                              order.is_gst_enabled) ? (
                            <>
                              <div className="flex justify-between items-center mb-1">
                                <span className="font-medium text-xs text-slate-600 dark:text-slate-400">
                                  Subtotal:
                                </span>
                                <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                                  ₹{itemsSubtotal.toFixed(2)}
                                </span>
                              </div>
                              {order.is_gst_enabled && (
                                <div className="flex justify-between items-center mb-1">
                                  <span className="font-medium text-xs text-slate-600 dark:text-slate-400">
                                    GST (5%):
                                  </span>
                                  <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                                    ₹{gstAmount.toFixed(2)}
                                  </span>
                                </div>
                              )}
                              {packagingFee > 0 &&
                                (order.order_type === "delivery" ||
                                  order.order_type === "takeaway") && (
                                  <div className="flex justify-between items-center mb-1">
                                    <span className="font-medium text-xs text-slate-600 dark:text-slate-400">
                                      Packaging Fee:
                                    </span>
                                    <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                                      ₹{packagingFee.toFixed(2)}
                                    </span>
                                  </div>
                                )}
                              <div className="flex justify-between items-center pt-1 border-t border-dashed border-slate-200 dark:border-slate-700">
                                <span className="font-bold text-xs text-slate-600 dark:text-slate-400">
                                  Total:
                                </span>
                                <span className="font-bold text-lg text-slate-900 dark:text-slate-100">
                                  ₹{total.toFixed(2)}
                                </span>
                              </div>
                            </>
                          ) : (
                            <div className="flex justify-between items-center">
                              <span className="font-semibold text-xs text-slate-600 dark:text-slate-400">
                                Total:
                              </span>
                              <span className="font-bold text-lg text-slate-900 dark:text-slate-100">
                                ₹{total.toFixed(2)}
                              </span>
                            </div>
                          );
                        })()}
                      </div>

                      {/* Status Button, Print, and Payment */}
                      {!isEditing && (
                        <div className="mt-3 flex flex-col gap-2">
                          <div className="w-full">
                            {(order.status === 'not_started' || order.status === 'started') ? (
                              <Button
                                onClick={() => updateOrderStatus(order.id, "cooking")}
                                disabled={updateLoading}
                                className="w-full bg-[#f00a20] hover:bg-red-700 text-white font-black shadow-lg shadow-red-900/20 h-10 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] transition-all">
                                <ChefHat className="w-5 h-5" />
                                Start Order
                              </Button>
                            ) : (order.status === "cooking" || order.status === "ready") ? (
                              <Button
                                onClick={() => updateOrderStatus(order.id, "completed")}
                                disabled={updateLoading}
                                className="w-full bg-[#247cff] hover:bg-blue-600 text-white font-black shadow-lg shadow-blue-900/20 h-10 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] transition-all">
                                <Check className="w-5 h-5" />
                                Complete Order
                              </Button>
                            ) : (
                              <div className="w-full py-2 bg-slate-100 dark:bg-slate-800 text-center rounded-xl text-slate-500 dark:text-slate-400 text-xs font-black uppercase tracking-widest">
                                {order.status}
                              </div>
                            )}
                          </div>

                          <div className="grid grid-cols-4 gap-2">
                            <Button
                              onClick={() => printOrder(order)}
                              disabled={updateLoading}
                              variant="outline"
                              className="h-9 px-0 w-full border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                              title="Print Bill">
                              <Printer className="w-4 h-4 mr-1.5" />
                              <span className="text-xs font-semibold">
                                Bill
                              </span>
                            </Button>

                            <Button
                              onClick={() => printKOTForOrder(order, true)}
                              disabled={updateLoading}
                              variant="outline"
                              className="h-9 px-0 w-full border-orange-500/50 bg-transparent text-orange-500 hover:bg-orange-500/10 dark:border-orange-500/50 dark:text-orange-500"
                              title="Print KOT">
                              <ChefHat className="w-4 h-4 mr-1.5" />
                              <span className="text-xs font-semibold">KOT</span>
                            </Button>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                updatePaymentStatus(
                                  order.id,
                                  order.payment_status === "paid"
                                    ? "pending"
                                    : "paid",
                                );
                              }}
                              disabled={updateLoading}
                              className={`h-9 px-0 w-full rounded-md font-bold text-[10px] md:text-xs uppercase tracking-wider transition-all border ${
                                order.payment_status === "paid"
                                  ? "bg-[#0bb958] text-white border-[#0bb958] dark:bg-[#0bb958] dark:text-white dark:border-[#0bb958]"
                                  : "bg-slate-100 text-[#f00a20] border-slate-200 dark:bg-slate-800/50 dark:text-[#f00a20] dark:border-slate-700/50"
                              }`}>
                              {order.payment_status === "paid"
                                ? "PAID"
                                : "UNPAID"}
                            </button>

                            {order.status === "cooking" && order.user_id ? (
                              <Button
                                onClick={() =>
                                  updateOrderStatus(order.id, "cancelled")
                                }
                                disabled={updateLoading}
                                variant="outline"
                                className="h-9 px-0 w-full border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50"
                                title="Cancel Order">
                                <Ban className="w-4 h-4" />
                              </Button>
                            ) : (
                              <div className="hidden"></div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Khata Dialog - Shared for all orders */}

        <Dialog
          open={khataDialogOpen}
          onOpenChange={(open) => {
            setKhataDialogOpen(open);
            if (open) {
              fetchStudents();
              setStudentSearch("");
            } else {
              setSelectedStudent("");
              setSelectedOrder(null);
              setStudentSearch("");
            }
          }}>
          <DialogContent className="sm:max-w-[500px] dark:bg-[#1e293b] dark:border-slate-800">
            <DialogHeader>
              <DialogTitle className="text-lg text-red-600 dark:text-red-500">
                {selectedOrder
                  ? `Add Order #${selectedOrder.serial_number} to Khata`
                  : "Add to Khata"}
              </DialogTitle>
              <DialogDescription className="text-slate-600 dark:text-slate-400 text-xs">
                {selectedOrder &&
                  `Total: ₹${(selectedOrder.canteen_amount || selectedOrder.total_amount || 0).toFixed(2)}`}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-3">
              <div className="space-y-2">
                <Input
                  placeholder="Search students..."
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  className="h-9 text-sm"
                  autoFocus
                />
                {loadingStudents ? (
                  <div className="space-y-2 py-2">
                    {[1, 2, 3].map((i) => (
                      <Skeleton
                        key={i}
                        className="h-12 w-full"
                      />
                    ))}
                  </div>
                ) : (
                  <div className="max-h-[250px] overflow-y-auto border rounded-md">
                    {students
                      .filter(
                        (student) =>
                          student.name
                            .toLowerCase()
                            .includes(deferredStudentSearch.toLowerCase()) ||
                          student.roll_number
                            .toLowerCase()
                            .includes(deferredStudentSearch.toLowerCase()),
                      )
                      .map((student) => (
                        <button
                          key={student.id}
                          onClick={() => setSelectedStudent(student.id)}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors border-b last:border-b-0 ${
                            selectedStudent === student.id
                              ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 font-medium"
                              : ""
                          }`}>
                          <div className="font-medium">{student.name}</div>
                          <div className="text-xs text-slate-500">
                            Roll: {student.roll_number}
                          </div>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={addOrderToKhata}
                disabled={!selectedStudent || addingToKhata}
                size="sm"
                className="bg-red-600 hover:bg-red-700 text-white">
                {addingToKhata ? "Adding..." : "Add to Khata"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Fixed Bottom CTA Button - Mobile & Tablet */}
        <Drawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}>
          <DrawerTrigger asChild>
            <div className="fixed bottom-16 left-0 right-0 px-4 md:px-8 py-4 bg-gradient-to-t from-slate-50 dark:from-[#0a0f1e] via-slate-50/95 dark:via-[#0a0f1e]/95 to-transparent pointer-events-none z-40">
              <Button
                className="w-full h-12 md:h-14 bg-red-600 hover:bg-red-700 active:bg-red-800 dark:bg-red-500 dark:hover:bg-red-600 text-white font-bold text-sm md:text-base shadow-lg active:scale-[0.98] transition-all pointer-events-auto rounded-xl"
                size="lg">
                <ChefHat className="w-4 h-4 mr-2" />
                Create New Order
                {orderItems.length > 0 && (
                  <span className="ml-2 bg-yellow-400 text-black text-xs font-black rounded-full h-6 min-w-[24px] px-2 flex items-center justify-center">
                    {orderItems.length}
                  </span>
                )}
              </Button>
            </div>
          </DrawerTrigger>
          <DrawerContent className="max-h-[90vh] bg-slate-50 dark:bg-[#0a0f1e]">
            <DrawerHeader className="border-b border-slate-200 dark:border-slate-800 px-4 md:px-8">
              <div className="flex items-center justify-between">
                <DrawerTitle className="text-red-600 text-lg md:text-xl font-bold">
                  {editingOrderId
                    ? `Edit Order #${editingOrderNumber}`
                    : `Order #${nextOrderNumber}`}
                </DrawerTitle>
                {total > 0 && (
                  <div className="text-xl font-bold text-slate-900 dark:text-white">
                    ₹{total.toFixed(2)}
                  </div>
                )}
              </div>
            </DrawerHeader>
            <div className="flex-1 overflow-y-auto">
              {/* Menu Items Grid - 2 cols on mobile, 3 cols on tablet */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 p-4 md:p-8">
                {filteredMenuItems.length === 0 ? (
                  <div className="col-span-2 md:col-span-3 text-center py-16 text-slate-400 dark:text-slate-500">
                    <ShoppingBag className="w-16 h-16 mx-auto mb-4 opacity-40" />
                    <p className="text-base font-medium">
                      {searchTerm
                        ? "No items found"
                        : "No menu items available"}
                    </p>
                    {searchTerm && (
                      <p className="text-xs mt-2 opacity-70">
                        Try a different search term
                      </p>
                    )}
                  </div>
                ) : (
                  filteredMenuItems.map((item, index) => {
                    const isSelected = orderItems.some(
                      (oi) => oi.menuItemId === item.id,
                    );
                    const selectedItem = orderItems.find(
                      (oi) => oi.menuItemId === item.id,
                    );
                    return (
                      <div
                        key={item.id}
                        style={{ animationDelay: `${index * 30}ms` }}
                        className={`h-auto p-3 flex flex-col justify-between gap-3 transition-all duration-200 rounded-xl relative bg-white dark:bg-slate-900 border animate-in fade-in slide-in-from-bottom-2 ${
                          isSelected
                            ? "border-red-500 shadow-sm"
                            : "border-slate-200 dark:border-slate-800"
                        }`}>
                        <div className="flex flex-col gap-1">
                          <p className="font-semibold text-sm leading-tight text-left text-slate-900 dark:text-slate-100 line-clamp-2 min-h-[2.5em]">
                            {item.name}
                          </p>
                          <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                            ₹{item.price.toFixed(2)}
                          </p>
                        </div>

                        {isSelected ? (
                          <div className="flex items-center justify-between bg-red-50 dark:bg-red-900/20 rounded-lg p-1 border border-red-100 dark:border-red-800/30">
                            <Button
                              onClick={() =>
                                selectedItem?.quantity === 1
                                  ? removeItem(item.id)
                                  : updateQuantity(item.id, -1)
                              }
                              size="sm"
                              variant="ghost"
                              className={`h-7 w-7 p-0 rounded-md ${
                                selectedItem?.quantity === 1
                                  ? "hover:bg-red-100 text-red-600 hover:text-red-700 dark:hover:bg-red-900/30"
                                  : "hover:bg-white dark:hover:bg-slate-800 hover:text-red-600 text-red-700 dark:text-red-400"
                              }`}>
                              {selectedItem?.quantity === 1 ? (
                                <Trash2 className="w-4 h-4" />
                              ) : (
                                <Minus className="w-4 h-4" />
                              )}
                            </Button>
                            <span className="font-bold text-sm text-red-700 dark:text-red-400 w-6 text-center">
                              {selectedItem?.quantity}
                            </span>
                            <Button
                              onClick={() => updateQuantity(item.id, 1)}
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 hover:bg-white dark:hover:bg-slate-800 hover:text-red-600 text-red-700 dark:text-red-400 rounded-md">
                              <Plus className="w-4 h-4" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            onClick={() => addItem(item)}
                            size="sm"
                            className="w-full h-9 bg-white hover:bg-slate-50 text-red-600 border border-red-200 hover:border-red-300 dark:bg-slate-800 dark:text-red-400 dark:border-slate-700 dark:hover:border-slate-600 font-semibold shadow-sm">
                            Add
                          </Button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            <DrawerFooter className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 pt-4 pb-6 px-4 md:px-8 space-y-3">
              {/* Cart Items as Badges */}
              {orderItems.length > 0 && (
                <div className="flex flex-wrap gap-2 pb-2">
                  {orderItems.map((item) => (
                    <div
                      key={item.menuItemId}
                      className="inline-flex items-center gap-1.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 px-3 py-1.5 rounded-full text-xs font-semibold">
                      <span>{item.name}</span>
                      <span className="text-red-600 dark:text-red-300">
                        ×{item.quantity}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Search Bar - Enhanced like menu page */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search menu items..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-11 text-sm rounded-xl pl-10 pr-10 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 focus:border-red-500 dark:focus:border-red-400 focus:ring-2 focus:ring-red-100 dark:focus:ring-red-900/30"
                />
                {isSearchStale && searchTerm && (
                  <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                    <div className="w-4 h-4 border-2 border-slate-300 dark:border-slate-600 border-t-red-500 rounded-full animate-spin" />
                  </div>
                )}
                {searchTerm && !isSearchStale && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSearchTerm("")}
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 p-0 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400">
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-2">
                {editingOrderId ? (
                  <>
                    <Button
                      onClick={() => {
                        cancelEditing();
                        setDrawerOpen(false);
                      }}
                      variant="outline"
                      className="h-11 text-sm font-semibold rounded-xl border-slate-300 dark:border-slate-700 active:scale-95 transition-transform">
                      <X className="w-4 h-4 mr-2" />
                      Cancel
                    </Button>
                    <Button
                      onClick={() => {
                        saveOrderEdit(editingOrderId);
                        setDrawerOpen(false);
                      }}
                      disabled={updateLoading || orderItems.length === 0}
                      className="h-11 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white disabled:opacity-50 active:scale-95 transition-all shadow-lg rounded-xl">
                      <Save className="w-4 h-4 mr-2" />
                      {updateLoading ? "Saving..." : "Save Changes"}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      onClick={() => setOrderItems([])}
                      disabled={orderItems.length === 0}
                      variant="outline"
                      className="h-11 text-sm font-semibold rounded-xl border-slate-300 dark:border-slate-700 active:scale-95 transition-transform disabled:opacity-50">
                      <RotateCcw className="w-4 h-4 mr-2" />
                      Reset
                    </Button>
                    <Button
                      onClick={() => {
                        submitOrder();
                        setDrawerOpen(false);
                      }}
                      disabled={loading || orderItems.length === 0}
                      className="h-11 text-sm font-bold bg-red-600 hover:bg-red-700 active:bg-red-800 text-white disabled:opacity-50 active:scale-95 transition-all shadow-lg rounded-xl">
                      <Printer className="w-4 h-4 mr-2" />
                      {loading ? "Processing..." : "Add Items"}
                    </Button>
                  </>
                )}
              </div>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </div> {/* Close Mobile Layout container */}

      {/* DESKTOP VIEW - Three Column Layout (≥ 1280px only) */}
      <div className="hidden xl:flex flex-row gap-6 w-full h-full">
        {!isKitchen && (
          <div className="contents">
            {/* Left Sidebar - Menu Items */}
            <div className="w-72 flex flex-col border border-slate-200 dark:border-slate-800/50 rounded-lg bg-white dark:bg-[#1e293b] shadow-sm">
          {/* Search */}
          <div className="p-3 md:p-4 border-b border-slate-200 dark:border-slate-700/50">
            <Input
              ref={searchInputRef}
              placeholder="Search items... (press /)"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-9 text-sm dark:bg-[#0f172a] dark:border-slate-700/50 dark:text-slate-200 dark:placeholder:text-slate-500"
            />
          </div>

          {/* Menu Items List */}
          <div className="flex-1 overflow-y-auto p-2">
            {menuLoading ? (
              <div className="space-y-2 p-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton
                    key={i}
                    className="h-16 w-full rounded-lg"
                  />
                ))}
              </div>
            ) : menuItems.length === 0 ? (
              <EmptyMenuState searchQuery={searchTerm} />
            ) : filteredMenuItems.length === 0 ? (
              <div className="text-center py-12 text-slate-400 dark:text-slate-500">
                <ShoppingBag className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <p className="text-sm font-medium">No items found</p>
                <p className="text-xs mt-1 opacity-70">
                  Try a different search
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-1 gap-2">
                {filteredItems.map((item, idx) => {
                  const isKeyboardFocused =
                    focusSection === "menu" && menuIndex === idx;
                  return (
                    <Button
                      key={item.id}
                      onClick={() => addItem(item)}
                      variant="outline"
                      className={`w-full justify-between h-auto p-2 md:p-3 bg-white dark:bg-[#0f172a] hover:bg-red-600 hover:text-white dark:hover:bg-red-500 transition-colors group dark:border-slate-700/50 ${
                        isKeyboardFocused
                          ? "ring-2 ring-red-500 ring-offset-1 bg-red-50 dark:bg-red-900/20"
                          : ""
                      }`}>
                      <div className="text-left flex-1">
                        <p className="font-semibold text-xs md:text-sm leading-tight text-slate-800 dark:text-slate-200">
                          {item.name}
                        </p>
                        <p className="text-[10px] md:text-xs text-slate-500 dark:text-slate-400 group-hover:text-white">
                          ₹{item.price.toFixed(2)}
                        </p>
                      </div>
                      <Plus className="w-3 h-3 md:w-4 md:h-4 ml-1 md:ml-2 shrink-0" />
                    </Button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Middle Section - Order Summary */}
        <div className="flex-1 flex flex-col gap-3 md:gap-4 min-h-0">
          <Card className="flex-1 flex flex-col min-w-0 min-h-0 dark:bg-[#1e293b] dark:border-slate-800/50">
            <CardHeader className="pb-2 md:pb-3 border-b border-slate-200 dark:border-slate-700/50 px-3 md:px-6 py-3 md:py-4">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                <div className="flex items-center gap-2 md:gap-3">
                  <CardTitle className="text-lg md:text-2xl text-slate-900 dark:text-white">
                    {editingOrderId ? (
                      <>
                        <span className="text-red-500">Editing</span> #
                        {editingOrderNumber}
                      </>
                    ) : (
                      <>Order #{nextOrderNumber}</>
                    )}
                  </CardTitle>
                  {editingOrderId && (
                    <span className="text-[10px] md:text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 px-2 py-1 rounded-full font-semibold">
                      EDIT
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {/* Sound Toggle Button */}
                  <button
                    onClick={toggleSound}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-semibold text-xs transition-all ${
                      isSoundEnabled
                        ? "bg-green-600 text-white hover:bg-green-700 shadow-md"
                        : "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/50 border border-amber-300 dark:border-amber-700"
                    }`}
                    title={
                      isSoundEnabled
                        ? "Sound on - Click to mute"
                        : "Sound off - Click to enable"
                    }>
                    {isSoundEnabled ? (
                      <Volume2 className="w-3.5 h-3.5" />
                    ) : (
                      <VolumeX className="w-3.5 h-3.5" />
                    )}
                    <span className="hidden sm:inline">
                      {isSoundEnabled ? "Sound On" : "Sound Off"}
                    </span>
                  </button>
                  <span className="text-xs md:text-sm text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 md:px-3 py-1 rounded-full w-fit">
                    {orderItems.length} items
                  </span>
                </div>
              </div>
            </CardHeader>

            <CardContent className="flex-1 overflow-y-auto p-2 md:p-4">
              {orderItems.length === 0 ? (
                <div className="flex items-center justify-center h-full text-slate-500 dark:text-slate-400 py-8">
                  <p className="text-sm md:text-base">
                    Select items to create order
                  </p>
                </div>
              ) : (
                <div className="space-y-2 md:space-y-3">
                  {orderItems.map((item, idx) => {
                    const isCartFocused =
                      focusSection === "cart" && cartIndex === idx;
                    return (
                      <div
                        key={item.menuItemId}
                        className={`flex items-center justify-between bg-slate-100 dark:bg-[#0f172a] p-2 md:p-4 rounded-lg border border-slate-200 dark:border-slate-700/50 hover:border-red-500 dark:hover:border-red-500 transition-colors ${
                          isCartFocused
                            ? "ring-2 ring-red-500 ring-offset-1 border-red-500"
                            : ""
                        }`}>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-xs md:text-sm text-slate-800 dark:text-slate-200 truncate">
                            {item.name}
                          </p>
                          <p className="text-[10px] md:text-xs text-slate-500 dark:text-slate-400">
                            ₹{item.canteen_price.toFixed(2)} each
                          </p>
                        </div>

                        <div className="flex items-center gap-1 md:gap-2 ml-2 md:ml-4">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => updateQuantity(item.menuItemId, -1)}
                            className="h-7 w-7 md:h-8 md:w-8 p-0">
                            <Minus className="w-3 h-3 md:w-4 md:h-4" />
                          </Button>
                          <span className="w-6 md:w-8 text-center font-bold text-xs md:text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-1 md:px-2 py-1 rounded">
                            {item.quantity}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => updateQuantity(item.menuItemId, 1)}
                            className="h-7 w-7 md:h-8 md:w-8 p-0">
                            <Plus className="w-3 h-3 md:w-4 md:h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeItem(item.menuItemId)}
                            className="h-7 w-7 md:h-8 md:w-8 p-0 text-destructive hover:bg-destructive/10">
                            <Trash2 className="w-3 h-3 md:w-4 md:h-4" />
                          </Button>
                        </div>

                        <div className="text-right ml-2 md:ml-4 font-semibold text-xs md:text-sm min-w-[50px] md:min-w-[70px]">
                          ₹{(item.canteen_price * item.quantity).toFixed(2)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>

            {/* Footer with Total and Actions */}
            <div className="border-t border-slate-200 dark:border-slate-700/50 p-2 space-y-2 bg-slate-50 dark:bg-slate-900/50 shrink-0">
              {!editingOrderId && (
                <>
                  <div className="grid grid-cols-2 gap-2 md:gap-3">
                    <div className="space-y-1">
                      <Label
                        htmlFor="order-type"
                        className="text-xs text-slate-600 dark:text-slate-400">
                        Order Type
                      </Label>
                      <Select
                        value={orderType}
                        onValueChange={(value: any) => setOrderType(value)}>
                        <SelectTrigger
                          id="order-type"
                          className="h-9 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="dine-in">Dine-In</SelectItem>
                          <SelectItem value="takeaway">Takeaway</SelectItem>
                          <SelectItem value="delivery">Delivery</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label
                        htmlFor="payment-status"
                        className="text-xs text-slate-600 dark:text-slate-400">
                        Payment
                      </Label>
                      <Select
                        value={paymentStatus}
                        onValueChange={(value: any) => setPaymentStatus(value)}>
                        <SelectTrigger
                          id="payment-status"
                          className="h-9 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="paid">Paid</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="mt-2 text-left">
                    <Label
                      htmlFor="order-note"
                      className="text-xs text-slate-600 dark:text-slate-400">
                      Order Note (press N)
                    </Label>
                    <Input
                      ref={noteInputRef}
                      id="order-note"
                      placeholder="e.g. Less spicy, Extra sauce..."
                      value={orderNote}
                      onChange={(e) => setOrderNote(e.target.value)}
                      className="h-8 text-xs mt-1 dark:bg-[#0f172a] dark:border-slate-700/50"
                    />
                  </div>
                </>
              )}

              {/* Total Display - Fixed at bottom */}
              <div className="bg-white dark:bg-[#0f172a] border border-slate-200 dark:border-slate-700/50 rounded-lg p-2">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-slate-600 dark:text-slate-400 text-xs">
                    Subtotal
                  </span>
                  <span className="text-xs font-medium text-slate-900 dark:text-slate-100">
                    ₹{total.toFixed(2)}
                  </span>
                </div>
                {gstAmount > 0 && (
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-slate-600 dark:text-slate-400 text-xs">
                      GST (5%)
                    </span>
                    <span className="text-xs font-medium text-slate-900 dark:text-slate-100">
                      ₹{gstAmount.toFixed(2)}
                    </span>
                  </div>
                )}
                {packagingFee > 0 && (
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-slate-600 dark:text-slate-400 text-xs">
                      Packaging Fee
                    </span>
                    <span className="text-xs font-medium text-slate-900 dark:text-slate-100">
                      ₹{packagingFee.toFixed(2)}
                    </span>
                  </div>
                )}
                {deliveryFee > 0 && (
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-slate-600 dark:text-slate-400 text-xs">
                      Delivery Fee
                    </span>
                    <span className="text-xs font-medium text-slate-900 dark:text-slate-100">
                      ₹{deliveryFee.toFixed(2)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center border-t border-slate-200 dark:border-slate-700/50 pt-1.5">
                  <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                    Total
                  </span>
                  <span className="text-xl font-bold text-red-600 dark:text-red-500">
                    ₹{grandTotal.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              {editingOrderId ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    onClick={() => saveOrderEdit(editingOrderId)}
                    disabled={updateLoading || orderItems.length === 0}
                    className="bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 text-white font-semibold h-9 text-sm"
                    size="lg">
                    <Save className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                    {updateLoading ? "Saving..." : "Save"}
                  </Button>
                  <Button
                    onClick={cancelEditing}
                    disabled={updateLoading}
                    variant="outline"
                    className="font-semibold h-9 text-sm dark:border-slate-700/50 dark:text-slate-300 dark:hover:bg-slate-800/50">
                    <X className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    onClick={submitOrder}
                    disabled={loading || orderItems.length === 0}
                    className="bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 text-white font-semibold col-span-2 h-9 text-xs"
                    size="lg">
                    <Printer className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                    {loading ? "Processing..." : "Print & Submit"}
                  </Button>
                  <Button
                    onClick={() => setOrderItems([])}
                    variant="outline"
                    className="font-semibold h-9 p-0">
                    <RotateCcw className="w-3 h-3 md:w-4 md:h-4" />
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
      )}

      {/* Right Sidebar - Order Management */}
      <div className={`flex-col border border-slate-200 dark:border-slate-800/50 rounded-lg bg-white dark:bg-[#1e293b] shadow-lg h-full min-h-0 flex ${isKitchen ? 'flex-1 max-w-5xl mx-auto w-full' : 'w-[26rem]'}`}>
        <div className="p-3 md:p-3 lg:p-4 border-b border-slate-200 dark:border-slate-700/50 bg-slate-100 dark:bg-[#0f172a] flex flex-wrap gap-3 justify-between items-center">
          <div>
              <h3 className="font-bold text-base md:text-base lg:text-lg text-red-600 dark:text-red-500">
                Order Management
              </h3>
              <p className="text-[10px] md:text-[11px] lg:text-xs text-slate-600 dark:text-slate-400">
                Edit, update status and manage orders
              </p>
            </div>
            {isKitchen && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPrepSummary(true)}
                className="h-8 text-[10px] font-bold border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30"
              >
                Prep Summary
              </Button>
            )}
          </div>

          {/* Desktop Tabs for Kitchen Users */}
          {isKitchen && (
            <div className="px-3 md:px-3 lg:p-4 border-b border-slate-200 dark:border-slate-700/50 bg-slate-50 dark:bg-[#0a0f1e] shrink-0">
              <div className="flex gap-1 p-1 bg-slate-200 dark:bg-[#1e293b] rounded-lg w-full">
                {/* <button
                  className={`flex-1 py-1.5 md:py-2 text-xs font-bold rounded-md transition-all ${viewTab === 'instant' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                  onClick={() => setViewTab('instant')}
                >
                  Instant
                </button> */}
                <button
                  className={`flex-1 py-1.5 md:py-2 text-xs font-bold rounded-md transition-all ${viewTab === 'scheduled' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                  onClick={() => setViewTab('scheduled')}
                >
                  Scheduled
                </button>
              </div>
              
              {viewTab === 'scheduled' && (
                <div className="flex flex-col gap-2 mt-3 data-[state=open]:animate-in data-[state=closed]:animate-out fade-in-0 fade-out-0">
                  <div className="flex items-center gap-2">
                    <Select value={currentDatePreset} onValueChange={handleDatePresetChange}>
                      <SelectTrigger className="h-8 text-xs flex-1 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 font-semibold shadow-sm">
                        <SelectValue placeholder="Date" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="today">Today's Orders</SelectItem>
                        <SelectItem value="tomorrow">Tomorrow's</SelectItem>
                        <SelectItem value="yesterday">Yesterday's</SelectItem>
                        <SelectItem value="custom">Choose Date...</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                        <Button 
                          variant="outline"
                          size="sm"
                          onClick={handleStartCookingAll}
                          disabled={updateLoading || displayedOrders.filter(o => o.status === 'not_started' || o.status === 'started').length === 0}
                          className="h-8 px-3 text-[10px] font-bold border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-900/30"
                        >
                          Start Cooking All
                        </Button>
                        <Button 
                          variant="outline"
                          size="sm"
                          onClick={handleCompleteAll}
                          disabled={updateLoading || displayedOrders.filter(o => o.status === 'cooking' || o.status === 'ready').length === 0}
                          className="h-8 px-3 text-[10px] font-bold border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-500 hover:bg-emerald-100 dark:hover:bg-emerald-900/30"
                        >
                          Complete All
                        </Button>
                    </div>
                    {currentDatePreset === 'custom' && (
                      <input 
                        type="date"
                        value={filterDate}
                        onChange={(e) => setFilterDate(e.target.value)}
                        className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-2 h-8 text-xs w-[110px] text-slate-600 dark:text-slate-400 shadow-sm outline-none focus:ring-2 focus:ring-red-500"
                      />
                    )}
                  </div>
                  
                  {/* Schedule Tabs */}
                  {activeSchedules.length > 0 && (
                    <>
                      <div className="flex gap-1 overflow-x-auto pb-1 mt-1 scrollbar-hide">
                        <button
                          onClick={() => setSelectedScheduleId('all')}
                          className={`px-3 py-1.5 text-xs font-bold rounded-full transition-colors whitespace-nowrap shrink-0 ${
                            selectedScheduleId === 'all'
                              ? 'bg-red-600 text-white shadow-sm'
                              : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                          }`}
                        >
                          All Schedules
                        </button>
                        {activeSchedules.map(schedule => (
                          <button
                            key={schedule.id}
                            onClick={() => setSelectedScheduleId(schedule.id)}
                            className={`px-3 py-1.5 text-xs font-bold rounded-full transition-colors whitespace-nowrap shrink-0 ${
                              selectedScheduleId === schedule.id
                                ? 'bg-red-600 text-white shadow-sm'
                                : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                            }`}
                          >
                            {schedule.name}
                          </button>
                        ))}
                      </div>

                      {/* Desktop Arrival Timer Banner */}
                      {selectedScheduleId !== 'all' && (
                        <div className="mt-2 text-left">
                          {(() => {
                            const activeSchedule = activeSchedules.find(s => s.id === selectedScheduleId);
                            if (!activeSchedule) return null;
                            return (
                              <ScheduleTimer 
                                schedule={activeSchedule} 
                                targetDateStr={filterDate} 
                                variant="arrival" 
                                scheduleName={activeSchedule.name}
                              />
                            );
                          })()}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {updateLoading && (
            <div className="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800/50 px-4 py-2 flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-sm text-red-700 dark:text-red-400 font-medium">
                Updating order...
              </span>
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-3 relative">
            
            {ordersLoading ? (
              <OrdersSkeleton />
            ) : displayedOrders.length === 0 ? (
              <EmptyOrdersState />
            ) : viewTab === 'scheduled' && isKitchen ? (
              /* TABBED TABLE LAYOUT FOR SCHEDULED ORDERS */
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 overflow-hidden shadow-sm hidden md:block">
                <table className="w-full text-left text-xs md:text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px] md:text-xs">
                      <th className="py-3 px-3">Order</th>
                      <th className="py-3 px-3">Items</th>
                      <th className="py-3 px-3 text-center">Print</th>
                      <th className="py-3 px-3 text-center">Info</th>
                      <th className="py-3 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                    {displayedOrders.map((order) => {
                       const schedule = schedules.find(s => s.id === order.scheduled_category_id);
                       const isOptimisticallyUpdating = optimisticUpdates.has(order.id);
                       
                       return (
                        <tr 
                          key={order.id} 
                          className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors relative ${
                            order.status === 'completed' ? 'opacity-50 grayscale' : ''
                          }`}
                        >
                          {/* Optimistic update overlay */}
                          {isOptimisticallyUpdating && (
                            <td colSpan={5} className="absolute inset-0 bg-white/60 dark:bg-slate-900/60 backdrop-blur-[1px] z-10 flex items-center justify-center">
                              <div className="flex items-center gap-2 bg-white dark:bg-slate-800 rounded-full px-4 py-2 shadow-sm border border-slate-200 dark:border-slate-700">
                                <div className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Updating...</span>
                              </div>
                            </td>
                          )}
                          
                          <td className="py-3 px-3 align-top min-w-[5rem]">
                            <div className="flex flex-col gap-1">
                              <span className="font-black text-slate-900 dark:text-slate-100 text-sm md:text-base">
                                #{order.serial_number}
                              </span>
                              {schedule && (
                                <ScheduleTimer schedule={schedule} targetDateStr={filterDate} />
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-3 align-top">
                            <ul className="space-y-1">
                              {(order.order_items || []).map((item: any, idx: number) => (
                                <li key={idx} className="flex items-start text-xs font-medium text-slate-700 dark:text-slate-300">
                                  <span className="font-bold text-slate-900 dark:text-slate-100 mr-2 shrink-0">{item.quantity}x</span>
                                  <span className="leading-tight">{item.menu_items?.name || "Unknown"}</span>
                                </li>
                              ))}
                            </ul>
                            {order.note && (
                               <div className="mt-1.5 inline-flex items-center gap-1 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded text-[10px] font-bold border border-amber-200 dark:border-amber-800/50">
                                 <AlertCircle className="w-3 h-3" /> Note Included
                               </div>
                            )}
                          </td>
                          <td className="py-3 px-3 align-middle text-center">
                             <Button
                                onClick={() => printKOTForOrder(order, true)}
                                disabled={updateLoading}
                                variant="outline"
                                className="h-7 w-7 p-0 shrink-0 mx-auto rounded-md border-orange-200 dark:border-orange-900 text-orange-600 dark:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/30"
                                title="Print KOT"
                             >
                               <Printer className="w-3.5 h-3.5" />
                             </Button>
                          </td>
                          <td className="py-3 px-3 align-middle text-center">
                             <Button
                                onClick={() => {
                                  setSelectedInfoOrder(order);
                                  setInfoDialogOpen(true);
                                }}
                                variant="ghost"
                                className="h-7 w-7 p-0 hover:bg-slate-100 dark:hover:bg-slate-700/50 mx-auto rounded-full"
                                title="Customer Info"
                             >
                                <Info className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                             </Button>
                          </td>
                          <td className="py-3 px-3 align-middle text-right">
                            {order.status !== 'completed' && order.status !== 'cancelled' ? (
                              <Button
                                onClick={() => {
                                  const nextStatus = (order.status === 'not_started' || order.status === 'started') ? 'cooking' : 'completed';
                                  updateOrderStatus(order.id, nextStatus);
                                }}
                                disabled={updateLoading}
                                className={`h-8 text-white font-black text-[10px] md:text-xs shadow-lg active:scale-95 transition-all flex items-center gap-1.5 px-3 rounded-lg ${
                                  (order.status === 'not_started' || order.status === 'started') 
                                    ? "bg-amber-600 hover:bg-amber-700 shadow-amber-900/20" 
                                    : "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-900/20"
                                }`}
                                size="sm"
                              >
                                {(order.status === 'not_started' || order.status === 'started') ? (
                                  <>
                                    <ChefHat className="w-3.5 h-3.5" />
                                    <span>Cook</span>
                                  </>
                                ) : (
                                  <>
                                    <Check className="w-4 h-4" />
                                    <span>Done</span>
                                  </>
                                )}
                              </Button>
                            ) : (
                               <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">{order.status}</span>
                            )}
                          </td>
                        </tr>
                       )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              /* INSTANT ORDERS LIST VIEW (Original Code) */
              <div className="space-y-3">
              {displayedOrders.map((order, idx) => {
                const isEditing = editingOrderId === order.id;
                const isExpanded = expandedOrderId === order.id;
                const isKeyboardSelected =
                  focusSection === "orders" && orderIndex === idx;
                const displayItems = isEditing
                  ? editingItems
                  : order.order_items || [];
                const total = isEditing
                  ? editingItems.reduce(
                      (sum, item) =>
                        sum +
                        (item.canteen_price || item.price) * item.quantity,
                      0,
                    )
                  : order.canteen_amount || order.total_amount;
                const isOptimisticallyUpdating = optimisticUpdates.has(
                  order.id,
                );

                return (
                  <div
                    key={order.id}
                    onClick={() =>
                      setExpandedOrderId(isExpanded ? null : order.id)
                    }
                    className={`rounded-lg border-2 text-xs md:text-xs lg:text-sm transition-all cursor-pointer ${
                      isKeyboardSelected
                        ? "ring-2 ring-red-600 ring-offset-2 dark:ring-offset-slate-900 transform scale-[1.02] z-10 shadow-lg"
                        : ""
                    } ${
                      (order.status === "not_started" || order.status === "started")
                        ? "border-red-600 bg-slate-50 dark:bg-slate-900/20"
                        : (order.status === "cooking" || order.status === "ready")
                        ? "border-blue-600 bg-slate-50 dark:bg-slate-900/20"
                        : "border-slate-300 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-900/20"
                    }`}>
                    {/* Optimistic update overlay */}
                    {isOptimisticallyUpdating && (
                      <div className="absolute inset-0 bg-white/60 dark:bg-slate-900/60 backdrop-blur-[1px] z-10 flex items-center justify-center">
                        <div className="flex items-center gap-2 bg-white dark:bg-slate-800 rounded-full px-4 py-2 shadow-lg">
                          <div className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                            Updating...
                          </span>
                        </div>
                      </div>
                    )}
                    <div className="p-2 md:p-2 lg:p-3">
                      {/* Header */}
                      <div className="flex items-start justify-between gap-2 mb-2">
                        {/* Left Group */}
                        <div className="flex items-center gap-2">
                          <div className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 w-8 h-8 rounded-full flex items-center justify-center shrink-0 border border-slate-200 dark:border-slate-700">
                            <span className="font-bold text-sm">
                              #{order.serial_number}
                            </span>
                          </div>
                          <div className="flex flex-col min-w-0">
                            <p className="font-bold text-xs text-slate-800 dark:text-slate-200 truncate leading-tight">
                              {order.users?.name || "Guest"}
                            </p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium leading-tight">
                              {order.users?.phone}
                            </p>
                          </div>
                        </div>

                        {/* Right Group: Badge + Actions */}
                        <div className="flex items-center gap-1">
                          {order.order_type && (
                            <span
                              className={`hidden sm:inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold text-white shadow-sm whitespace-nowrap bg-[#247cff]`}>
                              {order.order_type === "dine-in" && (
                                <UtensilsCrossed className="w-2.5 h-2.5 mr-1" />
                              )}
                              {order.order_type === "takeaway" && (
                                <Package className="w-2.5 h-2.5 mr-1" />
                              )}
                              {order.order_type === "delivery" && (
                                <Bike className="w-2.5 h-2.5 mr-1" />
                              )}
                              {order.order_type === "dine-in" ? "Dine-in" : order.order_type.charAt(0).toUpperCase() + order.order_type.slice(1)}
                            </span>
                          )}

                          {!isEditing && (
                            <div
                              className="flex items-center gap-0.5 ml-0.5"
                              onClick={(e) => e.stopPropagation()}>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setSelectedOrder(order);
                                  setKhataDialogOpen(true);
                                }}
                                className="h-6 w-6 p-0 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200">
                                <Plus className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => startEditingOrder(order)}
                                className="h-6 w-6 p-0 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200">
                                <Edit2 className="w-3 h-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => deleteOrder(order.id)}
                                className="h-6 w-6 p-0 hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-600 dark:hover:text-red-500 text-slate-400 dark:text-slate-500">
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Items - Show when expanded or currently editing */}
                      {(isExpanded || isEditing) && (
                        <div className="space-y-1 mb-2">
                          {displayItems.map((item: any, idx: number) => (
                            <div
                              key={idx}
                              className="bg-white dark:bg-slate-900 rounded p-1.5 text-xs">
                              <div className="flex justify-between items-start gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-slate-800 dark:text-slate-200 leading-tight">
                                    {item.menu_items?.name || "Unknown"}
                                  </p>
                                  {item.menu_items?.description && (
                                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 leading-snug">
                                      {item.menu_items.description}
                                    </p>
                                  )}
                                </div>
                                <span className="font-bold ml-2 shrink-0">
                                  ×{item.quantity}
                                </span>
                              </div>
                            </div>
                          ))}
                          {isEditing && (
                            <div className="text-center py-1 text-[10px] text-red-600 dark:text-red-400 font-medium bg-red-50 dark:bg-red-900/20 rounded">
                              Edit items on left →
                            </div>
                          )}
                        </div>
                      )}

                      {/* Note Section */}
                      <div className="mb-2 px-1">
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedNoteOrder(order);
                            setNoteDialogOpen(true);
                          }}
                          className={`group relative cursor-pointer rounded-lg p-2 border border-dashed transition-all ${
                            order.note
                              ? "bg-amber-50/50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/50 hover:border-amber-300 dark:hover:border-amber-700"
                              : "bg-slate-50/50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                          }`}>
                          <div className="flex items-center gap-1.5">
                            {order.note ? (
                              <Edit2 className="w-3 h-3 text-amber-500/70 shrink-0" />
                            ) : (
                              <Plus className="w-3 h-3 text-slate-500/70 shrink-0" />
                            )}
                            <div className="flex-1 min-w-0 flex items-center gap-1.5">
                              <span className="text-[9px] font-bold text-slate-600/70 dark:text-slate-400 uppercase tracking-wider shrink-0">
                                {order.note ? "Note:" : "Add Note"}
                              </span>
                              {order.note && (
                                <p className="text-[11px] text-slate-700 dark:text-slate-300 font-medium truncate">
                                  {order.note}
                                </p>
                              )}
                            </div>
                            <span className="text-[9px] font-semibold text-blue-600 dark:text-blue-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                              {order.note ? "See More" : "Add"}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Total */}
                      <div className="flex justify-between items-center py-2 border-t border-dashed border-slate-300 dark:border-slate-600">
                        <span className="font-semibold text-xs text-slate-600 dark:text-slate-400">
                          Total:
                        </span>
                        <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                          ₹{total.toFixed(2)}
                        </span>
                      </div>

                      {/* Footer Actions */}
                      {!isEditing && (
                        <div
                          className="mt-2 flex flex-col gap-2"
                          onClick={(e) => e.stopPropagation()}>
                          {/* 1. Main Status Action - Full Width */}
                          <div className="w-full">
                            {(order.status === 'not_started' || order.status === 'started') ? (
                              <Button
                                onClick={() => updateOrderStatus(order.id, "cooking")}
                                disabled={updateLoading}
                                className="w-full bg-[#f00a20] hover:bg-red-700 text-white font-black shadow-lg shadow-red-900/20 h-9 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] transition-all text-xs">
                                <ChefHat className="w-4 h-4" />
                                Start Order
                              </Button>
                            ) : (order.status === "cooking" || order.status === "ready") ? (
                              <Button
                                onClick={() => updateOrderStatus(order.id, "completed")}
                                disabled={updateLoading}
                                className="w-full bg-[#247cff] hover:bg-blue-600 text-white font-black shadow-lg shadow-blue-900/20 h-9 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] transition-all text-xs">
                                <Check className="w-4 h-4" />
                                Complete Order
                              </Button>
                            ) : (
                              <div className="w-full py-2 bg-slate-100 dark:bg-slate-800 text-center rounded-xl text-slate-500 dark:text-slate-400 text-xs font-black uppercase tracking-widest">
                                {order.status}
                              </div>
                            )}
                          </div>

                          {/* 2. Secondary Actions Grid */}
                          <div className="grid grid-cols-4 gap-1.5">
                            {/* Bill Button */}
                            <Button
                              onClick={() => printOrder(order)}
                              disabled={updateLoading}
                              variant="outline"
                              className="h-8 px-0 w-full border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800"
                              size="sm"
                              title="Print Bill">
                              <Printer className="w-3.5 h-3.5 mr-1" />
                              Bill
                            </Button>

                            {/* KOT Button */}
                            <Button
                              onClick={() => printKOTForOrder(order, true)}
                              disabled={updateLoading}
                              variant="outline"
                              className="h-8 px-0 w-full border-orange-500/50 bg-transparent text-orange-500 hover:bg-orange-500/10 dark:border-orange-500/50 dark:text-orange-500"
                              size="sm"
                              title="Print KOT">
                              <ChefHat className="w-3.5 h-3.5 mr-1" />
                              KOT
                            </Button>

                            {/* Payment Button */}
                            <Button
                              onClick={(e) => {
                                e.stopPropagation();
                                updatePaymentStatus(
                                  order.id,
                                  order.payment_status === "paid"
                                    ? "pending"
                                    : "paid",
                                );
                              }}
                              disabled={updateLoading}
                              variant="outline"
                              className={`h-8 px-0 w-full font-bold text-[10px] border ${
                                order.payment_status === "paid"
                                  ? "bg-[#0bb958] text-white border-[#0bb958] hover:text-white dark:bg-[#0bb958] dark:text-white dark:border-[#0bb958] hover:bg-[#0bb958] dark:hover:bg-[#0bb958]"
                                  : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700/50 text-[#f00a20] dark:text-[#f00a20] hover:bg-slate-50 dark:hover:bg-slate-900/50 hover:text-red-700"
                              }`}
                              size="sm">
                              {order.payment_status === "paid"
                                ? "PAID"
                                : "UNPAID"}
                            </Button>

                            {/* Cancel Button (Conditional) */}
                            {order.status === "cooking" && order.user_id ? (
                              <Button
                                onClick={() =>
                                  updateOrderStatus(order.id, "cancelled")
                                }
                                disabled={updateLoading}
                                variant="outline"
                                className="h-8 px-0 w-full border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 bg-white dark:bg-slate-800"
                                size="sm"
                                title="Cancel Order">
                                <Ban className="w-3.5 h-3.5" />
                              </Button>
                            ) : (
                              /* Empty div for grid alignment */
                              <div className="hidden"></div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              </div>
            )}
          </div>

        {/* Khata Dialog - Shared for all desktop orders */}
        <Dialog
            open={khataDialogOpen}
            onOpenChange={(open) => {
              setKhataDialogOpen(open);
              if (open) {
                fetchStudents();
                setStudentSearch("");
              } else {
                setSelectedStudent("");
                setSelectedOrder(null);
                setStudentSearch("");
              }
            }}>
            <DialogContent className="sm:max-w-[500px] dark:bg-[#1e293b] dark:border-slate-800">
              <DialogHeader>
                <DialogTitle className="text-lg text-red-600 dark:text-red-500">
                  {selectedOrder
                    ? `Add Order #${selectedOrder.serial_number} to Khata`
                    : "Add to Khata"}
                </DialogTitle>
                <DialogDescription className="text-slate-600 dark:text-slate-400 text-xs">
                  {selectedOrder &&
                    `Total: ₹${(selectedOrder.canteen_amount || selectedOrder.total_amount || 0).toFixed(2)}`}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-3">
                <div className="space-y-2">
                  <Input
                    placeholder="Search students by name or roll number..."
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    className="h-9 text-sm dark:bg-[#0f172a] dark:border-slate-700/50"
                    autoFocus
                  />
                  {loadingStudents ? (
                    <div className="space-y-2 py-2">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <Skeleton
                          key={i}
                          className="h-12 w-full"
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="max-h-[400px] overflow-y-auto border border-slate-200 dark:border-slate-700/50 rounded-md">
                      {students
                        .filter(
                          (student) =>
                            student.name
                              .toLowerCase()
                              .includes(deferredStudentSearch.toLowerCase()) ||
                            student.roll_number
                              .toLowerCase()
                              .includes(deferredStudentSearch.toLowerCase()),
                        )
                        .map((student) => (
                          <button
                            key={student.id}
                            onClick={() => setSelectedStudent(student.id)}
                            className={`w-full text-left px-4 py-3 text-sm hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors border-b border-slate-100 dark:border-slate-800/50 last:border-b-0 ${
                              selectedStudent === student.id
                                ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 font-medium"
                                : "text-slate-900 dark:text-slate-100"
                            }`}>
                            <div className="font-medium">{student.name}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              Roll: {student.roll_number}
                            </div>
                          </button>
                        ))}
                      {students.filter(
                        (student) =>
                          student.name
                            .toLowerCase()
                            .includes(deferredStudentSearch.toLowerCase()) ||
                          student.roll_number
                            .toLowerCase()
                            .includes(deferredStudentSearch.toLowerCase()),
                      ).length === 0 && (
                        <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                          No students found
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setKhataDialogOpen(false);
                    setSelectedStudent("");
                    setSelectedOrder(null);
                  }}
                  disabled={addingToKhata}
                  className="h-8 text-xs">
                  Cancel
                </Button>
                <Button
                  onClick={addOrderToKhata}
                  disabled={!selectedStudent || addingToKhata}
                  size="sm"
                  className="bg-red-600 hover:bg-red-700 text-white h-8 text-xs">
                  {addingToKhata ? "Adding..." : "Add to Khata"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

      </div>

      {/* Note Details Modal */}
      <Dialog
        open={noteDialogOpen}
        onOpenChange={setNoteDialogOpen}>
        <DialogContent className="sm:max-w-[500px] w-[95vw] bg-white dark:bg-[#1e293b] border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
          <DialogHeader className="border-b border-slate-100 dark:border-slate-800 pb-4">
            <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100 text-xl">
              <div className="bg-amber-100 dark:bg-amber-900/30 p-2.5 rounded-full">
                <Edit2 className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              Order Note
            </DialogTitle>
            <DialogDescription className="text-slate-500 dark:text-slate-400 pt-1">
              Instructions for Order #{selectedNoteOrder?.serial_number}
            </DialogDescription>
          </DialogHeader>
          <div className="py-6 overflow-y-auto max-h-[60vh]">
            {isEditingNote ? (
              <div className="space-y-4">
                <Textarea
                  value={editNoteText}
                  onChange={(e) => setEditNoteText(e.target.value)}
                  placeholder="Add note instructions..."
                  className="min-h-[150px] bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700 w-full"
                  maxLength={500}
                />
                <p className="text-right text-xs text-slate-400">
                  {editNoteText.length}/500
                </p>
              </div>
            ) : (
              <div className="bg-slate-50 dark:bg-[#0f172a] p-5 rounded-2xl border border-slate-100 dark:border-slate-800 min-h-[120px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-medium leading-relaxed text-base shadow-inner w-full break-all">
                {selectedNoteOrder?.note || "No content"}
              </div>
            )}
          </div>
          <DialogFooter className="flex flex-col sm:flex-row gap-2">
            {isEditingNote ? (
              <>
                <Button
                  onClick={() => setIsEditingNote(false)}
                  variant="outline"
                  size="lg"
                  className="w-full sm:w-auto">
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (selectedNoteOrder) {
                      updateOrderNote(selectedNoteOrder.id, editNoteText);
                    }
                  }}
                  size="lg"
                  disabled={updateLoading}
                  className="w-full sm:w-auto bg-amber-600 hover:bg-amber-700 text-white font-semibold">
                  {updateLoading ? "Saving..." : "Save Note"}
                </Button>
              </>
            ) : (
              <>
                <Button
                  onClick={() => setIsEditingNote(true)}
                  variant="outline"
                  size="lg"
                  className="w-full sm:w-auto flex items-center gap-2">
                  <Edit2 className="w-4 h-4" />
                  Edit Note
                </Button>
                <Button
                  onClick={() => setNoteDialogOpen(false)}
                  size="lg"
                  className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 font-semibold">
                  Close Note
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>


      {/* Preparation Summary Modal */}
      <Dialog open={showPrepSummary} onOpenChange={setShowPrepSummary}>
        <DialogContent className="sm:max-w-[500px] w-[95vw] bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden max-h-[90vh]">
          <DialogHeader className="border-b border-slate-100 dark:border-slate-800 pb-4">
            <DialogTitle className="flex items-center gap-2 text-slate-900 dark:text-white text-xl font-black">
              <div className="bg-red-50 dark:bg-red-950/30 p-2.5 rounded-full">
                <ChefHat className="w-5 h-5 text-red-600 dark:text-red-500" />
              </div>
              Preparation Summary
            </DialogTitle>
            <DialogDescription className="text-slate-500 dark:text-slate-400 pt-1 font-medium italic">
              Total items to prepare for {currentDatePreset === 'custom' ? filterDate : currentDatePreset.charAt(0).toUpperCase() + currentDatePreset.slice(1)}'s block (Visible Orders: {displayedOrders.length})
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 overflow-y-auto max-h-[50vh]">
            {prepSummaryItems.length === 0 ? (
              <div className="text-center py-10 text-slate-400 dark:text-slate-500 font-bold">No items to prepare.</div>
            ) : (
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 uppercase text-[10px] text-slate-400 dark:text-slate-500 font-black tracking-widest bg-slate-50/50 dark:bg-slate-800/30">
                    <th className="py-3 px-4">Item Name</th>
                    <th className="py-3 px-4 text-center">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {prepSummaryItems.map((item, idx) => (
                    <tr key={idx} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="py-3 px-4 font-bold text-slate-800 dark:text-slate-200">{item.name}</td>
                      <td className="py-3 px-4 text-center font-black text-red-600 dark:text-red-500 text-lg">{item.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <DialogFooter className="bg-slate-50 dark:bg-slate-800/50 p-4 -mx-6 -mb-6 md:-mx-4 md:-mb-4">
            <Button 
              onClick={() => setShowPrepSummary(false)}
              size="lg"
              className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white font-bold rounded-xl"
            >
              Close Summary
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Customer Info Modal for Scheduled Orders */}
      <Dialog
        open={infoDialogOpen}
        onOpenChange={setInfoDialogOpen}>
        <DialogContent className="sm:max-w-[400px] w-[95vw] bg-white dark:bg-[#1e293b] border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
          <DialogHeader className="border-b border-slate-100 dark:border-slate-800 pb-4">
            <DialogTitle className="flex items-center gap-2 text-slate-800 dark:text-slate-100 text-xl">
              <div className="bg-blue-100 dark:bg-blue-900/30 p-2.5 rounded-full">
                <Info className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              Customer Information
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4 text-center">
             <p className="text-xl font-black text-slate-900 dark:text-white">
                {selectedInfoOrder?.users?.name || "Guest Customer"}
             </p>
             <p className="text-lg font-bold text-slate-600 dark:text-slate-400">
                {selectedInfoOrder?.users?.phone || selectedInfoOrder?.user_addresses?.phone || "No Phone Number"}
             </p>
             {selectedInfoOrder?.users?.roll_number && (
               <p className="text-sm font-medium text-slate-500 italic">
                 Roll No: {selectedInfoOrder?.users?.roll_number}
               </p>
             )}
          </div>
          <DialogFooter>
            <Button
              onClick={() => setInfoDialogOpen(false)}
              size="lg"
              className="w-full bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 font-semibold">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
