import Swal from 'sweetalert2';

export const safeDelete = async (itemName, deleteCallback) => {
    // Step 1: Initial Warning
    const step1 = await Swal.fire({
        title: `Delete ${itemName}?`,
        text: "Are you sure you want to delete this record?",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Continue',
        cancelButtonText: 'Cancel'
    });

    if (step1.isConfirmed) {
        // Step 2: Final Confirmation
        const step2 = await Swal.fire({
            title: 'Final Confirmation',
            text: "This action is permanent and cannot be undone. Do you really want to continue?",
            icon: 'error',
            showCancelButton: true,
            confirmButtonColor: '#dc3545',
            cancelButtonColor: '#6c757d',
            confirmButtonText: 'Yes, Delete Permanently',
            cancelButtonText: 'Cancel',
            focusCancel: true
        });

        if (step2.isConfirmed) {
            await deleteCallback();
        }
    }
};

export const showSuccess = (message) => {
    Swal.fire({
        icon: 'success',
        title: 'Success!',
        text: message,
        timer: 2000,
        showConfirmButton: false
    });
};
