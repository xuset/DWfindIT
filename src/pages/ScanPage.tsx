// src/pages/ScanPage.tsx
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { ScanResult } from '../components/ScanResult';
import { Header } from '../components/Header';
import { BottomNav } from '../components/BottomNav';
import { useListStore } from '../store/listStore';
import { useScanItemStore } from '../store/scanItemStore';
import { useStore } from '../contexts/StoreContext';
import { supabase } from '../services/supabase';

export const ScanPage: React.FC = () => {
  const navigate = useNavigate();
  const { selectedStore, isLoading: isStoreLoading } = useStore();
  const { lists, fetchLists, currentList, setCurrentList } = useListStore();
  const { addItem, clearRecentScan } = useScanItemStore();

  const [scanError, setScanError] = useState<string | null>(null);
  const [scanSuccess, setScanSuccess] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [viewMode, setViewMode] = useState<'view' | 'add'>('view');
  const [lastScannedPart, setLastScannedPart] = useState<any>(null);
  const [cameraError, setCameraError] = useState<string | null>(null); // Separate camera errors

  // Load lists on mount
  useEffect(() => {
    if (lists.length === 0) fetchLists();
  }, [lists, fetchLists]);

  // Set default list
  useEffect(() => {
    if (lists.length > 0 && !currentList) {
      setCurrentList(lists[0]);
    }
  }, [lists, currentList, setCurrentList]);

  // Memoize the scan handler to prevent BarcodeScanner re-renders
  const handleScan = useCallback(async (barcode: string) => {
    if (isProcessing) return;
    
    console.log('📷 Processing barcode scan:', barcode);
    setScanError(null);
    setScanSuccess(null);
    setLastScannedPart(null);

    try {
      setIsProcessing(true);

      // DEBUG: Check current user and list ownership
      const { data: { user } } = await supabase.auth.getUser();
      console.log('🔐 Current user:', user?.id);
      console.log('📋 Current list:', currentList);
      console.log('🏪 Selected store:', selectedStore);

      // Fetch part from Supabase, using maybeSingle to avoid 406s
      const { data: partData, error: partError } = await supabase
        .from('parts')
        .select('*')
        .eq('part_number', barcode)
        .eq('store_location', selectedStore)
        .maybeSingle();

      if (partError || !partData) {
        throw new Error(`Part "${barcode}" not found in store ${selectedStore}.`);
      }
      setLastScannedPart(partData);

      // VIEW mode: just show the result
      if (viewMode === 'view') {
        setScanSuccess(`${barcode} → Bin: ${partData.bin_location}`);
        return;
      }

      // ADD mode: insert or update in scan_items
      if (!currentList) {
        throw new Error('No list selected.');
      }

      // DEBUG: Verify list belongs to current user
      const { data: listCheck, error: listError } = await supabase
        .from('lists')
        .select('id, name, user_id')
        .eq('id', currentList.id)
        .single();

      console.log('📝 List ownership check:', { listCheck, listError, userMatches: listCheck?.user_id === user?.id });

      if (listError || !listCheck) {
        throw new Error('List not found or access denied');
      }

      if (listCheck.user_id !== user?.id) {
        throw new Error('You do not have permission to add items to this list');
      }

      const { data: existingItem } = await supabase
        .from('scan_items')
        .select('*')
        .eq('barcode', barcode)
        .eq('list_id', currentList.id)
        .maybeSingle();

      if (existingItem) {
        const newQty = existingItem.quantity + 1;
        const { error: updateError } = await supabase
          .from('scan_items')
          .update({ quantity: newQty })
          .eq('id', existingItem.id);
        if (updateError) throw updateError;
        setScanSuccess(`Updated ${barcode} quantity to ${newQty}`);
      } else {
        // FIXED: Include ALL fields that exist in your scan_items table
        const scanItemData = {
          barcode: barcode,
          part_number: partData.part_number,
          bin_location: partData.bin_location,
          store_location: partData.store_location, // Include this since it exists in your table
          list_id: currentList.id,
          quantity: 1,
          notes: ''
          // Let database auto-handle: id, created_at, updated_at
        };

        console.log('💾 Saving scan item with exact data:', scanItemData);
        
        await addItem(scanItemData);
        setScanSuccess(`Added ${barcode} to list`);
      }
    } catch (error: any) {
      console.error('Scan processing error:', error);
      setScanError(error.message);
    } finally {
      setIsProcessing(false);
      // clear notifications after a few seconds
      setTimeout(() => setScanError(null), 3000);
      setTimeout(() => setScanSuccess(null), 3000);
    }
  }, [isProcessing, selectedStore, viewMode, currentList, addItem]);

  // Separate camera error handler that doesn't affect scanner state
  const handleCameraError = useCallback((error: string) => {
    console.error('Camera error:', error);
    setCameraError(error);
    // Auto-clear camera errors after 5 seconds
    setTimeout(() => setCameraError(null), 5000);
  }, []);

  // Memoize BarcodeScanner to prevent unnecessary re-renders
  const barcodeScannerComponent = useMemo(() => (
    <BarcodeScanner 
      onScanSuccess={handleScan} 
      onScanError={handleCameraError}
    />
  ), [handleScan, handleCameraError]);

  if (isStoreLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p>Loading store settings...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col pb-16 bg-gray-50">
      <Header title="Scan Barcode" showBackButton />

      <main className="flex-1 p-4 space-y-4">
        {/* Mode Toggle */}
        <div className="flex space-x-4">
          <button
            className={viewMode === 'view' ? 'font-bold text-orange-600' : 'text-gray-600'}
            onClick={() => setViewMode('view')}
          >
            View
          </button>
          <button
            className={viewMode === 'add' ? 'font-bold text-orange-600' : 'text-gray-600'}
            onClick={() => setViewMode('add')}
          >
            Add to List
          </button>
        </div>

        {/* Camera Scanner - Memoized to prevent re-mounting */}
        {barcodeScannerComponent}

        {/* Camera Error Display */}
        {cameraError && (
          <div className="p-2 bg-red-100 text-red-800 rounded">
            Camera Error: {cameraError}
          </div>
        )}

        {/* Scan Processing Feedback */}
        {scanError && (
          <div className="p-2 bg-red-100 text-red-800 rounded">
            {scanError}
          </div>
        )}
        {scanSuccess && (
          <div className="p-2 bg-green-100 text-green-800 rounded">
            {scanSuccess}
          </div>
        )}

        {/* Scan Result */}
        <ScanResult
          item={lastScannedPart}
          isLoading={isProcessing}
          error={scanError}
          clearResult={clearRecentScan}
          onSave={(updates) => {
            if (lastScannedPart && currentList) {
              // Include the current list ID when saving manually so RLS policies
              // that rely on list ownership pass correctly
              addItem({ ...lastScannedPart, ...updates, list_id: currentList.id });
            }
          }}
        />
      </main>

      <BottomNav />
    </div>
  );
};